"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Sparkles, CheckCircle2, Loader2 } from "lucide-react";

/** Public referral landing: prospect leaves name + phone → lead for the partner. */
export default function ReferPage() {
  const params = useParams();
  const code = String(params?.code ?? "");
  const [partner, setPartner] = useState<{ partnerName: string; company: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/refer/${encodeURIComponent(code)}`);
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setPartner(json.data);
      else setError(json?.error || "This link is not active.");
    })();
  }, [code]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/refer/${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim() || undefined }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok && json?.success) setDone(true);
    else setError(json?.error || "Could not send your request. Please retry.");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-5">
        <div className="text-center space-y-2">
          <div className="h-14 w-14 mx-auto rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center">
            <Sparkles className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">Book a professional deep clean</h1>
          {partner && <p className="text-sm text-slate-500">Recommended by <strong className="text-slate-800">{partner.partnerName}</strong> · {partner.company}</p>}
        </div>

        {error && <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}

        {done ? (
          <div className="text-center space-y-2 py-4">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
            <div className="text-lg font-semibold text-slate-900">Thank you!</div>
            <p className="text-sm text-slate-500">Our team will call you shortly to schedule your service.</p>
          </div>
        ) : (
          partner && (
            <form onSubmit={submit} className="space-y-3">
              <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Your name" className="w-full h-12 rounded-xl border border-slate-300 px-4 text-base" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="Phone number" inputMode="tel" className="w-full h-12 rounded-xl border border-slate-300 px-4 text-base" />
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Area / address (optional)" className="w-full h-12 rounded-xl border border-slate-300 px-4 text-base" />
              <button type="submit" disabled={busy} className="w-full h-14 rounded-xl bg-rose-500 text-white text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-rose-600 disabled:opacity-60">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Request a call back
              </button>
              <p className="text-[11px] text-slate-400 text-center">We only use your number to schedule your service.</p>
            </form>
          )
        )}
      </div>
    </div>
  );
}
