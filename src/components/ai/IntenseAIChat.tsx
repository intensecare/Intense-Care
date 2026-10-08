"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Square, RotateCcw, Copy, Check, AlertTriangle, Plus } from "lucide-react";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";

/**
 * INTENSE AI chat. Talks only to /api/ai/chat — the server decides what data
 * the assistant can see (the signed-in user's permissions, or the one job of
 * a customer's QR token). Nothing about the AI provider appears here.
 */

type Msg = { id: string; role: "user" | "assistant"; content: string; status?: string; error?: string; streaming?: boolean };

type Prompt = { label: string; q: string };

const SUGGESTIONS: Record<string, { suggested: Prompt[]; quick: Prompt[] }> = {
  admin: {
    suggested: [
      { label: "Business Performance", q: "How is the business performing this month compared with last month?" },
      { label: "Today's Summary", q: "Summarize today's business performance and anything that needs my attention." },
      { label: "Revenue Analysis", q: "Analyse our revenue this month versus last month — billed, collected, outstanding and by service." },
      { label: "Customer Analysis", q: "Analyse our customers: who books again, who hasn't booked again in 30 days, and our ratings." },
      { label: "QC Analysis", q: "What percentage of jobs passed QC on the first inspection this month, and what are the most common issues?" },
      { label: "Rework Analysis", q: "Are we getting too many reworks? Compare with last month and tell me the main causes." },
      { label: "Improve My Business", q: "Give me 5 practical ways to improve this business, based on our data." },
    ],
    quick: [
      { label: "Analyze Business", q: "Give me a management summary of the business this month." },
      { label: "Analyze Revenue", q: "Where is our revenue coming from, and where are we losing money?" },
      { label: "Analyze Customers", q: "Which customers haven't booked again, and how can we bring them back?" },
      { label: "Analyze Jobs", q: "Which jobs are taking longer than expected this month?" },
      { label: "Analyze QC", q: "Analyse QC results by Field Manager and by service this month." },
      { label: "Find Problems", q: "What are our biggest operational problems right now?" },
      { label: "Find Opportunities", q: "Which service should we promote, and what growth opportunities do you see?" },
      { label: "Improve Operations", q: "What should management focus on first to improve operations?" },
    ],
  },
  field_manager: {
    suggested: [
      { label: "My Day", q: "What are my jobs today and what should I do first?" },
      { label: "My Rework", q: "Do I have open rework items? What needs fixing?" },
      { label: "My Quality", q: "How did my jobs do in QC this month and what are the common issues?" },
      { label: "My Performance", q: "How am I performing this month — completed jobs, first-time QC pass, ratings?" },
    ],
    quick: [
      { label: "Avoid Rework", q: "Based on my QC issues, give me a checklist to avoid rework." },
      { label: "Find Problems", q: "Which of my jobs took longer than expected, and why might that be?" },
    ],
  },
  qc_inspector: {
    suggested: [
      { label: "QC Analysis", q: "Summarize QC results this month: inspections, first-time pass rate and common issues." },
      { label: "Rework Analysis", q: "Analyse rework this month compared with last month — by area and by Field Manager." },
      { label: "Repeat Rework", q: "Which jobs needed more than one rework round?" },
      { label: "Waiting for QC", q: "Which jobs are waiting for inspection right now?" },
    ],
    quick: [
      { label: "Find Problems", q: "Which areas and services fail QC most often?" },
      { label: "Improve Quality", q: "How can we raise the first-time QC pass rate? Base it on the data." },
    ],
  },
  tax_officer: {
    suggested: [
      { label: "GST This Month", q: "Summarize GST for this month: taxable value, CGST, SGST, IGST and total." },
      { label: "Compare GST", q: "Compare this month's GST with last month." },
      { label: "GST This Quarter", q: "Give me a GST summary for this quarter, month by month." },
      { label: "Largest Invoices", q: "List this month's largest GST invoices." },
    ],
    quick: [
      { label: "IGST Invoices", q: "Which GST invoices this month charged IGST?" },
      { label: "Unregistered Buyers", q: "How many GST invoices this month went to customers without a GSTIN?" },
    ],
  },
  customer: {
    suggested: [
      { label: "Where is my service?", q: "What's the status of my service?" },
      { label: "What happens next?", q: "What happens next with my service?" },
      { label: "My invoice", q: "Explain my invoice." },
    ],
    quick: [],
  },
};

const newId = () => Math.random().toString(36).slice(2);

export function IntenseAIChat({
  role,
  userName,
  token,
  storageKey,
  compact = false,
  dock = "desk",
}: {
  role: string;
  userName?: string;
  /** Customer QR token — the assistant then sees only that job. */
  token?: string;
  /** Keeps the conversation while moving around the app (cleared on sign-out). */
  storageKey: string;
  /** Inside a bottom sheet. */
  compact?: boolean;
  /** Which bottom tab bar the composer must sit above. */
  dock?: "desk" | "mobile";
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prompts = SUGGESTIONS[role] ?? SUGGESTIONS.customer;

  // Restore / persist this session's conversation.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) setMessages((JSON.parse(saved) as Msg[]).map((m) => ({ ...m, streaming: false, status: undefined })));
    } catch {}
  }, [storageKey]);
  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {}
  }, [messages, busy, storageKey]);

  useEffect(() => {
    fetch(`/api/ai/chat${token ? `?token=${encodeURIComponent(token)}` : ""}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setEnabled(!!j?.data?.enabled))
      .catch(() => setEnabled(false));
  }, [token]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const update = (id: string, f: (m: Msg) => Msg) => setMessages((prev) => prev.map((m) => (m.id === id ? f(m) : m)));

  const ask = useCallback(
    async (question: string, base?: Msg[]) => {
      const q = question.trim();
      if (!q || busy) return;
      const history = [...(base ?? messages), { id: newId(), role: "user" as const, content: q }];
      const answerId = newId();
      setMessages([...history, { id: answerId, role: "assistant", content: "", streaming: true, status: "Thinking" }]);
      setInput("");
      setBusy(true);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, messages: history.filter((m) => m.content && !m.error).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })) }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          update(answerId, (m) => ({ ...m, streaming: false, status: undefined, error: j?.error || "Intense AI couldn't answer right now. Please try again." }));
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            if (!line.trim()) continue;
            let e: { type: string; text?: string; message?: string };
            try {
              e = JSON.parse(line);
            } catch {
              continue;
            }
            if (e.type === "delta") update(answerId, (m) => ({ ...m, content: m.content + (e.text ?? ""), status: undefined }));
            else if (e.type === "status") update(answerId, (m) => ({ ...m, status: e.text }));
            else if (e.type === "error") update(answerId, (m) => ({ ...m, error: e.message, status: undefined }));
          }
        }
        update(answerId, (m) => ({ ...m, streaming: false, status: undefined, error: m.error ?? (m.content ? undefined : "No answer came back. Please try again.") }));
      } catch {
        if (ctrl.signal.aborted) update(answerId, (m) => ({ ...m, streaming: false, status: undefined, content: m.content || "Stopped." }));
        else update(answerId, (m) => ({ ...m, streaming: false, status: undefined, error: "You're offline. Check your connection and try again." }));
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, messages, token]
  );

  const stop = () => abortRef.current?.abort();
  const newChat = () => {
    stop();
    setMessages([]);
    setInput("");
    try {
      sessionStorage.removeItem(storageKey);
    } catch {}
    inputRef.current?.focus();
  };
  const retry = (id: string) => {
    const idx = messages.findIndex((m) => m.id === id);
    const q = [...messages.slice(0, idx)].reverse().find((m) => m.role === "user");
    if (!q) return;
    const base = messages.slice(0, messages.indexOf(q));
    void ask(q.content, base);
  };
  const copy = async (m: Msg) => {
    await navigator.clipboard?.writeText(m.content).catch(() => {});
    setCopied(m.id);
    setTimeout(() => setCopied(null), 1500);
  };

  const empty = messages.length === 0;
  const first = userName?.split(" ")[0];

  return (
    <div className={cn("flex flex-col", compact ? "min-h-0" : "min-h-[calc(100dvh-12rem)]")}>
      {/* Brand header */}
      <div className={cn("flex items-center justify-between gap-3", compact && "pr-10")}>
        <div className="flex items-center gap-3 min-w-0">
          <AiMark />
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-[0.18em] text-zinc-950">INTENSE AI</h1>
            <p className="text-sm text-zinc-500 truncate">{role === "customer" ? "Your service assistant" : "Your Business Intelligence Assistant"}</p>
          </div>
        </div>
        {!empty && (
          <button onClick={newChat} className="h-10 px-3 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-700 inline-flex items-center gap-1.5 hover:bg-zinc-50 shrink-0">
            <Plus className="h-4 w-4" aria-hidden /> New chat
          </button>
        )}
      </div>

      {enabled === false && (
        <div role="status" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Intense AI isn&apos;t switched on yet. {role === "admin" ? "Add the AI key on the server to start using it." : "Please ask your administrator."}
        </div>
      )}

      <div className="flex-1 mt-5 space-y-4" aria-live="polite">
        {empty ? (
          <div className="space-y-6">
            <section className="rounded-3xl bg-zinc-950 text-white p-5 sm:p-7 relative overflow-hidden">
              <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-rose-500/30 blur-3xl" />
              <p className="relative text-xl sm:text-2xl font-semibold">Hi{first ? ` ${first}` : ""}, I&apos;m Intense AI.</p>
              <p className="relative mt-2 text-base text-zinc-300 max-w-xl">
                {role === "customer"
                  ? "Ask me anything about your service — status, your team, the quality check or your invoice."
                  : role === "tax_officer"
                  ? "Ask me about your GST invoices and GST reports."
                  : role === "admin"
                  ? "Ask me anything about your business, operations, customers, jobs, quality, revenue, or improvement opportunities."
                  : "Ask me about your jobs, quality results, rework and how to improve them."}
              </p>
            </section>

            <section aria-labelledby="ai-suggested">
              <h2 id="ai-suggested" className="text-sm font-semibold text-zinc-500 mb-2">Suggested</h2>
              <div className="flex flex-wrap gap-2">
                {prompts.suggested.map((p) => (
                  <button key={p.label} disabled={!enabled || busy} onClick={() => void ask(p.q)} className="min-h-11 px-4 rounded-full border border-zinc-200 bg-white text-sm font-semibold text-zinc-800 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50">
                    {p.label}
                  </button>
                ))}
              </div>
            </section>

            {prompts.quick.length > 0 && (
              <section aria-labelledby="ai-quick">
                <h2 id="ai-quick" className="text-sm font-semibold text-zinc-500 mb-2">Quick actions</h2>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {prompts.quick.map((p) => (
                    <button key={p.label} disabled={!enabled || busy} onClick={() => void ask(p.q)} className="min-h-14 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left text-sm font-semibold text-zinc-900 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-rose-500 shrink-0" aria-hidden />
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        ) : (
          messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-zinc-900 text-white px-4 py-3 text-base whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            ) : (
              <article key={m.id} className="rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 shadow-sm animate-in fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <AiMark small />
                  <span className="text-xs font-bold tracking-[0.16em] text-zinc-500">INTENSE AI</span>
                </div>
                {m.content && <Markdown text={m.content} />}
                {m.streaming && m.status && (
                  <div className="flex items-center gap-2 text-sm text-zinc-500" role="status">
                    <Dots /> {m.status}…
                  </div>
                )}
                {m.streaming && !m.status && !m.content && <Dots />}
                {m.error && (
                  <div role="alert" className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-800">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="flex-1 min-w-0">{m.error}</span>
                    <button onClick={() => retry(m.id)} disabled={busy} className="h-9 px-3 rounded-lg bg-white border border-red-200 font-semibold inline-flex items-center gap-1">
                      <RotateCcw className="h-4 w-4" aria-hidden /> Try again
                    </button>
                  </div>
                )}
                {!m.streaming && m.content && !m.error && (
                  <div className="mt-3 flex justify-end">
                    <button onClick={() => void copy(m)} className="h-9 px-2.5 rounded-lg text-sm text-zinc-500 hover:bg-zinc-100 inline-flex items-center gap-1.5">
                      {copied === m.id ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied === m.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </article>
            )
          )
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className={cn(
          "z-20 mt-4 bg-zinc-50/95 backdrop-blur pt-2",
          compact ? "sticky -bottom-[max(1.25rem,env(safe-area-inset-bottom))] sm:-bottom-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 bg-white" : dock === "mobile" ? "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] pb-3" : "sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 pb-3"
        )}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm focus-within:border-rose-400 focus-within:ring-2 focus-within:ring-rose-100">
          <label htmlFor={`ai-input-${storageKey}`} className="sr-only">Ask Intense AI</label>
          <textarea
            id={`ai-input-${storageKey}`}
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            maxLength={4000}
            disabled={enabled === false}
            placeholder={role === "customer" ? "Ask about your service…" : "Ask Intense AI anything…"}
            className="flex-1 min-w-0 resize-none bg-transparent px-2 py-2.5 text-base outline-none max-h-40 [field-sizing:content] disabled:opacity-50"
          />
          {busy ? (
            <button type="button" onClick={stop} className="h-11 w-11 shrink-0 rounded-xl bg-zinc-900 text-white inline-flex items-center justify-center" aria-label="Stop">
              <Square className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() || enabled === false} className="h-11 w-11 shrink-0 rounded-xl bg-rose-500 text-white inline-flex items-center justify-center disabled:opacity-40" aria-label="Send">
              <ArrowUp className="h-5 w-5" aria-hidden />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-xs text-zinc-400">Intense AI only sees what your account can see. Check important numbers before acting.</p>
      </form>
    </div>
  );
}

export function AiMark({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden className={cn("shrink-0 rounded-xl bg-gradient-to-br from-rose-500 to-zinc-900 text-white flex items-center justify-center shadow-sm", small ? "h-6 w-6 rounded-lg" : "h-11 w-11")}>
      <Sparkles className={small ? "h-3.5 w-3.5" : "h-5 w-5"} />
    </span>
  );
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Working">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-2 w-2 rounded-full bg-rose-400 animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}
