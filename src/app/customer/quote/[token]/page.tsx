"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Skeleton, ErrorState, Notice } from "@/components/ui/states";
import { QuotationDocument, type QuoteDetail } from "@/components/quote/QuotationDocument";

/**
 * The customer's quotation page — opened from the shared link, no login.
 * The server returns only what is printed on the quotation; the customer
 * can accept or decline it once while it is still valid.
 */
export default function CustomerQuotePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<QuoteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(token)}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setError(json?.error || "This quotation link is not valid.");
      else {
        setData(json.data);
        setName((n) => n || json.data.customer.name || "");
      }
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
  }, [token]);
  useEffect(() => {
    void load();
  }, [load]);

  const answer = async (action: "accept" | "decline") => {
    if (name.trim().length < 2) return setNotice({ tone: "error", text: "Please type your name." });
    setBusy(action);
    setNotice(null);
    try {
      const res = await fetch(`/api/quote/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, name: name.trim() }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) setNotice({ tone: "error", text: json?.error || "Couldn't send your answer. Please try again." });
      else {
        setNotice({ tone: "success", text: action === "accept" ? "Thank you — the quotation is accepted. We'll be in touch to schedule the work." : "Thanks for letting us know. The quotation is marked as declined." });
        await load();
      }
    } catch {
      setNotice({ tone: "error", text: "You're offline. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  };

  if (error) return <main className="min-h-screen bg-zinc-50 px-4 py-10"><ErrorState message={error} /></main>;
  if (!data) return <main className="min-h-screen bg-zinc-50 px-4 py-6 max-w-3xl mx-auto space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96" /></main>;

  const open = data.quote.status === "sent" || data.quote.status === "draft";

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-6 sm:py-10 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto space-y-4">
        {notice && <Notice tone={notice.tone} className="print:hidden">{notice.text}</Notice>}
        <QuotationDocument detail={data} />
        <div className="print:hidden space-y-4">
          {open ? (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
              <h2 className="text-base font-semibold text-zinc-950">Your answer</h2>
              <Field label="Your name" htmlFor="cq-name" required>
                <Input id="cq-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button size="lg" onClick={() => void answer("accept")} loading={busy === "accept"} disabled={!!busy}><CheckCircle2 className="h-5 w-5" aria-hidden /> Accept quotation</Button>
                <Button size="lg" variant="outline" onClick={() => void answer("decline")} loading={busy === "decline"} disabled={!!busy}><XCircle className="h-5 w-5" aria-hidden /> Decline</Button>
              </div>
            </section>
          ) : data.quote.status === "expired" ? (
            <Notice tone="info">This quotation has expired. Please contact us for an updated one.</Notice>
          ) : null}
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print / Save as PDF</Button>
        </div>
      </div>
    </main>
  );
}
