"use client";

import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, Copy, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { PAYMENT_STATUS_LABEL, type CustomerPaymentStatus } from "@/lib/payments";

export interface CustomerPayment {
  method: "UPI";
  status: CustomerPaymentStatus;
  outstanding: number;
  available: boolean;
  canPay: boolean;
  attempt: null | { id: string; status: string; reference: string; amount: number; utrLast4: string | null; submittedAt: string | null; reviewNote: string | null };
}

const inr = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(n);

interface Started {
  attemptId: string;
  reference: string;
  amount: number;
  payeeName: string;
  vpa: string;
  upiUri: string;
}

/**
 * Pay-now for the customer's own invoice. Opening a UPI app (or coming back from it) proves nothing, so the page never says
 * "paid" on its own: the customer reports the UTR from their UPI app, and an Admin confirms it against the bank.
 */
export function PayPanel({ token, invoiceNumber, jobId, total, amountPaid, payment, onChanged }: { token: string; invoiceNumber: string; jobId: string | null; total: number; amountPaid: number; payment: CustomerPayment; onChanged: () => void }) {
  const [started, setStarted] = useState<Started | null>(null);
  const [utr, setUtr] = useState("");
  const [busy, setBusy] = useState<"start" | "submit" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noApp, setNoApp] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const launchedAt = useRef(0);
  const hiddenSince = useRef(0);

  const status = payment.status;
  const attempt = payment.attempt;
  const waitingForUtr = !!started || attempt?.status === "INITIATED";
  const attemptId = started?.attemptId ?? (attempt?.status === "INITIATED" ? attempt.id : null);

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/customer/job/${encodeURIComponent(token)}/payment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) return { ok: false as const, error: "You're offline. Check your connection and try again." };
    const j = await res.json().catch(() => null);
    return res.ok && j?.success ? { ok: true as const, data: j.data } : { ok: false as const, error: (j?.error as string) || "Something went wrong. Please try again." };
  };

  // Coming back from the UPI app: nothing is assumed — we just bring the "enter your reference" form into view.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenSince.current = Date.now();
      else if (hiddenSince.current && launchedAt.current) {
        setNoApp(false);
        setNotice("Welcome back. A payment app opening doesn't confirm payment. If you paid, enter the reference number (UTR) from the app below so we can verify it.");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const payNow = async () => {
    setBusy("start");
    setError(null);
    setNotice(null);
    const r = await call({ action: "start" });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    const s = r.data as Started;
    setStarted(s);
    launchedAt.current = Date.now();
    hiddenSince.current = 0;
    setNoApp(false);
    // Hand over to the phone's UPI apps (the system shows a chooser: Google Pay, PhonePe, Paytm, BHIM …).
    window.location.href = s.upiUri;
    // If the page never went to the background, no UPI app handled the link (desktop, or none installed).
    window.setTimeout(() => {
      if (!hiddenSince.current) {
        setNoApp(true);
        void import("qrcode").then((Q) => Q.toDataURL(s.upiUri, { margin: 1, width: 220 })).then(setQr).catch(() => setQr(null));
      }
    }, 2500);
  };

  const submit = async () => {
    if (!attemptId) return;
    setBusy("submit");
    setError(null);
    const r = await call({ action: "submit", attemptId, utr });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setStarted(null);
    setUtr("");
    setNotice("Thank you. Your payment reference was sent for checking. We'll confirm it once we see it in our bank account.");
    onChanged();
  };

  const cancel = async () => {
    if (!attemptId) return;
    setBusy("cancel");
    const r = await call({ action: "cancel", attemptId });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setStarted(null);
    setNoApp(false);
    setNotice("No problem — nothing was charged by us. You can pay any time from this page.");
    onChanged();
  };

  const copy = (text: string) => void navigator.clipboard?.writeText(text).then(() => setNotice("Copied."));

  const tone = status === "PAID" ? "text-emerald-700" : status === "PAYMENT_REVIEW_REQUIRED" || status === "PAYMENT_INITIATED" ? "text-amber-700" : status === "FAILED" ? "text-red-700" : "text-zinc-900";

  return (
    <section className="bg-white rounded-3xl border border-zinc-200 p-5 shadow-sm space-y-4 print:hidden" aria-label="Payment">
      <h2 className="text-lg font-semibold text-zinc-950">Payment</h2>
      <dl className="rounded-2xl border border-zinc-200 divide-y divide-zinc-100 text-sm">
        {([
          ["Invoice", invoiceNumber],
          ...(jobId ? ([["Job ID", jobId]] as [string, string][]) : []),
          ["Invoice total", inr(total)],
          ["Already paid", inr(amountPaid)],
          ["Outstanding", inr(payment.outstanding)],
          ["Payment method", "UPI (Google Pay, PhonePe, Paytm …)"],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-zinc-600">{k}</dt><dd className={cn("font-medium text-right break-all", k === "Outstanding" && "text-base font-semibold")}>{v}</dd></div>
        ))}
        <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-zinc-600">Payment status</dt><dd className={cn("font-semibold text-right", tone)}>{PAYMENT_STATUS_LABEL[status]}</dd></div>
      </dl>

      {status === "PAID" && <p className="flex items-center gap-2 text-emerald-700 font-semibold"><CheckCircle2 className="h-5 w-5" aria-hidden /> Payment received. Thank you!</p>}

      {status === "PAYMENT_REVIEW_REQUIRED" && (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2">
          <Clock className="h-5 w-5 shrink-0 mt-0.5" aria-hidden /> <span>We received your payment reference{attempt?.utrLast4 ? ` (ending ${attempt.utrLast4})` : ""} and are checking it against our bank account. You&apos;ll see this invoice marked paid once it&apos;s confirmed. You don&apos;t need to pay again.</span>
        </p>
      )}

      {status === "FAILED" && attempt?.status === "REJECTED" && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" aria-hidden /> <span>We couldn&apos;t confirm your last payment{attempt.reviewNote ? `: ${attempt.reviewNote}` : "."} If money left your account, please contact us with your reference. You can also try again.</span>
        </p>
      )}

      {notice && <p role="status" className="rounded-2xl bg-sky-50 border border-sky-200 px-4 py-3 text-sm text-sky-900">{notice}</p>}
      {error && <p role="alert" className="rounded-2xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">{error}</p>}

      {status !== "PAID" && status !== "PAYMENT_REVIEW_REQUIRED" && !payment.available && (
        <p className="text-sm text-zinc-600">Online payment isn&apos;t set up yet. Please pay as described on your invoice, or contact us — you can still complete everything else on this page.</p>
      )}

      {payment.canPay && !waitingForUtr && (
        <button onClick={() => void payNow()} disabled={busy === "start"} className="h-14 w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-60">
          <Smartphone className="h-5 w-5" aria-hidden /> {busy === "start" ? "Preparing…" : `Pay now · ${inr(payment.outstanding)}`}
        </button>
      )}

      {payment.canPay && waitingForUtr && (
        <div className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <p className="text-sm text-zinc-800 font-semibold">Did you complete the payment?</p>
          <p className="text-sm text-zinc-600">Opening a payment app doesn&apos;t confirm anything. After paying {inr(started?.amount ?? attempt?.amount ?? payment.outstanding)}, type the <strong>UTR / reference number</strong> shown in your UPI app (a 12-digit number), and we&apos;ll verify it.</p>
          <input value={utr} onChange={(e) => setUtr(e.target.value)} inputMode="text" autoCapitalize="characters" autoComplete="off" placeholder="UTR / UPI reference number" aria-label="UTR or UPI reference number" className="h-12 w-full rounded-xl border border-zinc-300 px-3.5 text-base font-mono" />
          <button onClick={() => void submit()} disabled={busy === "submit" || utr.trim().length < 8} className="h-12 w-full rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50">{busy === "submit" ? "Sending…" : "I've paid — send for verification"}</button>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void payNow()} disabled={busy === "start"} className="h-11 px-4 rounded-xl border border-zinc-300 text-sm font-semibold">Open payment app again</button>
            <button onClick={() => void cancel()} disabled={busy === "cancel"} className="h-11 px-4 rounded-xl border border-zinc-300 text-sm font-semibold text-zinc-700">I didn&apos;t pay</button>
          </div>
        </div>
      )}

      {noApp && started && (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">No UPI app opened.</p>
          <p>Open this page on your phone, or pay from any UPI app by scanning this code or using the UPI ID. Amount: <strong>{inr(started.amount)}</strong>. Payee: <strong>{started.payeeName}</strong>.</p>
          {qr && /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt="UPI payment QR code" width={220} height={220} className="rounded-xl bg-white p-2 mx-auto" />}
          <button onClick={() => copy(started.vpa)} className="h-11 px-4 rounded-xl bg-white border border-amber-300 font-semibold inline-flex items-center gap-2"><Copy className="h-4 w-4" aria-hidden /> Copy UPI ID: {started.vpa}</button>
          <p className="text-xs">Then enter your reference number below.</p>
        </div>
      )}
    </section>
  );
}
