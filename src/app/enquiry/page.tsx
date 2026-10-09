"use client";

import React, { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid"] as const;

/**
 * Public enquiry form (no sign-in) — link it from the website, Google
 * Business Profile ("?utm_source=gmb") or ads. The same API also serves the
 * embeddable widget in /public/enquiry-widget.js for the company website.
 */
export default function EnquiryPage() {
  const started = useRef(Date.now());
  const [attr, setAttr] = useState<Record<string, string>>({});
  const [f, setF] = useState({ name: "", phone: "", email: "", service: "", location: "", postalCode: "", preferredDate: "", message: "", company_website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const a: Record<string, string> = {};
    for (const k of UTM_KEYS) {
      const v = p.get(k);
      if (v) a[k] = v.slice(0, 300);
    }
    a.landingPage = window.location.href.slice(0, 500);
    if (document.referrer) a.referrer = document.referrer.slice(0, 500);
    setAttr(a);
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/public/enquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, ...attr, startedAt: started.current }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) setError(j?.error || "Couldn't send your enquiry. Please call us.");
      else setDone(j.message);
    } catch {
      setError("You're offline. Check your connection and try again.");
    }
    setBusy(false);
  };

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-8">
      <div className="max-w-lg mx-auto rounded-2xl border border-zinc-200 bg-white p-5 sm:p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-zinc-950">Book a cleaning enquiry</h1>
        <p className="text-sm text-zinc-600 mt-1">Tell us what you need — we&apos;ll call you back with a quote.</p>
        {done ? (
          <div className="mt-6 rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-900 flex gap-2"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden /> {done}</div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate={false}>
            {error && <Notice tone="error">{error}</Notice>}
            <Field label="Your name" required htmlFor="eq-name"><Input id="eq-name" value={f.name} onChange={set("name")} required autoComplete="name" maxLength={120} /></Field>
            <Field label="Phone" required htmlFor="eq-phone"><Input id="eq-phone" type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} required autoComplete="tel" maxLength={24} /></Field>
            <Field label="Email" htmlFor="eq-email"><Input id="eq-email" type="email" value={f.email} onChange={set("email")} autoComplete="email" maxLength={160} /></Field>
            <Field label="Service needed" htmlFor="eq-svc"><Input id="eq-svc" value={f.service} onChange={set("service")} placeholder="Deep cleaning, sofa, kitchen…" maxLength={200} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Area / address" htmlFor="eq-loc" className="col-span-2"><Input id="eq-loc" value={f.location} onChange={set("location")} autoComplete="street-address" maxLength={300} /></Field>
              <Field label="PIN code" htmlFor="eq-pin"><Input id="eq-pin" inputMode="numeric" value={f.postalCode} onChange={set("postalCode")} autoComplete="postal-code" maxLength={16} /></Field>
            </div>
            <Field label="Preferred date" htmlFor="eq-date"><Input id="eq-date" type="date" value={f.preferredDate} onChange={set("preferredDate")} /></Field>
            <Field label="Message" htmlFor="eq-msg"><textarea id="eq-msg" rows={3} value={f.message} onChange={set("message")} maxLength={2000} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" /></Field>
            {/* Honeypot: hidden from people, filled by bots. */}
            <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="eq-hp">Company website</label>
              <input id="eq-hp" tabIndex={-1} autoComplete="off" value={f.company_website} onChange={set("company_website")} />
            </div>
            <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!f.name.trim() || !f.phone.trim()}>Send enquiry</Button>
            <p className="text-xs text-zinc-500">We use your details only to reply to this enquiry.</p>
          </form>
        )}
      </div>
    </main>
  );
}
