"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import {
  Save,
  CheckCircle2,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const {
    systemSettings,
    updateSystemSettings,
    fontSize,
    setFontSize,
  } = useApp();
  const { currentUser, can } = useAuth();

  const [resendCooldownSeconds, setResendCooldownSeconds] = useState(systemSettings.resendCooldownSeconds || 60);
  const [nextDayDispatchTime, setNextDayDispatchTime] = useState(systemSettings.nextDayDispatchTime || "20:00");
  const [taxRatePercent, setTaxRatePercent] = useState(
    systemSettings.taxRatePercent === undefined || systemSettings.taxRatePercent === null
      ? 18
      : systemSettings.taxRatePercent
  );
  const [taxLabel, setTaxLabel] = useState(systemSettings.taxLabel || "GST");
  const [gstin, setGstin] = useState(systemSettings.gstin || "");

  // Company identity printed on tax invoices and customer statements.
  const [companyName, setCompanyName] = useState(systemSettings.companyName || "");
  const [companyTagline, setCompanyTagline] = useState(systemSettings.companyTagline || "");
  const [companyAddress, setCompanyAddress] = useState(systemSettings.companyAddress || "");
  const [companyPhone, setCompanyPhone] = useState(systemSettings.companyPhone || "");
  const [companyEmail, setCompanyEmail] = useState(systemSettings.companyEmail || "");

  const [sacCode, setSacCode] = useState(systemSettings.sacCode || "");
  const [googleReviewUrl, setGoogleReviewUrl] = useState(systemSettings.googleBusinessReviewUrl || "");
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // §1 Google Calendar integration status (Settings → Integrations).
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    envConfigured: boolean;
    calendarEmail: string | null;
    connectedAt: string | null;
    lastSyncAt: string | null;
  } | null>(null);
  const [googleChecking, setGoogleChecking] = useState(false);

  const checkGoogleStatus = async () => {
    setGoogleChecking(true);
    try {
      const res = await fetch("/api/integrations/google");
      const json = await res.json().catch(() => null);
      if (res.ok && json?.success) setGoogleStatus(json.data);
    } catch {
      /* non-fatal */
    } finally {
      setGoogleChecking(false);
    }
  };

  React.useEffect(() => {
    if (can("integrations.manage")) void checkGoogleStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await updateSystemSettings({
      resendCooldownSeconds,
      nextDayDispatchTime,
      companyName: companyName.trim(),
      companyTagline: companyTagline.trim(),
      companyAddress: companyAddress.trim(),
      companyPhone: companyPhone.trim(),
      companyEmail: companyEmail.trim(),
      taxRatePercent: Math.min(100, Math.max(0, Number(taxRatePercent) || 0)),
      taxLabel: taxLabel.trim() || "GST",
      gstin: gstin.trim(),
      sacCode: sacCode.trim(),
      googleBusinessReviewUrl: googleReviewUrl.trim(),
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
    setIsSaving(false);
  };

  const section = "rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4";

  return (
    <AdminLayout>
      <PageHeader title="Settings" description="Your company details, tax and the review link customers see." />

      <form onSubmit={handleSave} className="max-w-3xl space-y-6 pb-24">
        <section className={section} aria-labelledby="s-company">
          <div>
            <h2 id="s-company" className="text-lg font-semibold text-zinc-950">Company</h2>
            <p className="text-sm text-zinc-500">Printed on invoices and customer statements.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company name" htmlFor="st-name"><Input id="st-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>
            <Field label="Tagline" htmlFor="st-tag"><Input id="st-tag" value={companyTagline} onChange={(e) => setCompanyTagline(e.target.value)} /></Field>
          </div>
          <Field label="Address" htmlFor="st-addr"><Input id="st-addr" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder="Street, area, city, PIN" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Support phone" htmlFor="st-phone"><Input id="st-phone" type="tel" inputMode="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="+91 98765 43210" /></Field>
            <Field label="Support email" htmlFor="st-email"><Input id="st-email" type="email" inputMode="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="hello@yourcompany.com" /></Field>
          </div>
        </section>

        <section className={section} aria-labelledby="s-tax">
          <div>
            <h2 id="s-tax" className="text-lg font-semibold text-zinc-950">Tax</h2>
            <p className="text-sm text-zinc-500">Used for new invoices. Existing invoices keep their figures.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Tax rate (%)" hint="Set 0 to turn tax off" htmlFor="st-rate"><Input id="st-rate" type="number" inputMode="decimal" min={0} max={100} step="0.01" value={taxRatePercent} onChange={(e) => setTaxRatePercent(Number(e.target.value))} /></Field>
            <Field label="Tax label" htmlFor="st-label"><Input id="st-label" value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} /></Field>
            <Field label="GSTIN" htmlFor="st-gstin"><Input id="st-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29AAACA9921K1Z2" /></Field>
            <Field label="SAC code" htmlFor="st-sac"><Input id="st-sac" value={sacCode} onChange={(e) => setSacCode(e.target.value)} placeholder="998533" /></Field>
          </div>
        </section>

        <section className={section} aria-labelledby="s-review">
          <div>
            <h2 id="s-review" className="text-lg font-semibold text-zinc-950">Customer review</h2>
            <p className="text-sm text-zinc-500">After approving, customers see a “Leave Google review” button that opens this link.</p>
          </div>
          <Field label="Google review link" hint="Leave empty to hide the button" htmlFor="st-review"><Input id="st-review" type="url" inputMode="url" value={googleReviewUrl} onChange={(e) => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review" /></Field>
        </section>

        <section className={section} aria-labelledby="s-text">
          <div>
            <h2 id="s-text" className="text-lg font-semibold text-zinc-950">Text size</h2>
            <p className="text-sm text-zinc-500">Makes everything easier to read on this device.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Text size">
            {([["sm", "Small"], ["md", "Normal"], ["lg", "Large"], ["xl", "Extra large"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={fontSize === k} onClick={() => setFontSize(k)} className={fontSize === k ? "h-12 rounded-xl border-2 border-rose-500 bg-rose-50 text-sm font-semibold text-rose-700" : "h-12 rounded-xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700"}>
                {l}
              </button>
            ))}
          </div>
        </section>

        {can("integrations.manage") && (
          <section className={section} aria-labelledby="s-int">
            <h2 id="s-int" className="text-lg font-semibold text-zinc-950">Integrations</h2>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3">
              <span className="flex items-center gap-3 min-w-0">
                <CalendarDays className="h-5 w-5 text-zinc-400 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-950">Google Calendar</span>
                  <span className="block text-sm text-zinc-500 truncate">{googleStatus?.connected ? `Jobs sync to ${googleStatus.calendarEmail ?? "your calendar"}` : "Not connected — ask your developer to connect it."}</span>
                </span>
              </span>
              <span className={googleStatus?.connected ? "shrink-0 rounded-full bg-emerald-50 text-emerald-800 px-2.5 py-1 text-xs font-semibold" : "shrink-0 rounded-full bg-zinc-100 text-zinc-600 px-2.5 py-1 text-xs font-semibold"}>
                {googleChecking ? "Checking…" : googleStatus?.connected ? "Connected" : "Off"}
              </span>
            </div>
          </section>
        )}

        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 py-3">
          <div className="max-w-3xl mx-auto lg:mx-8 flex items-center justify-end gap-3">
            {savedSuccess && <span role="status" className="text-sm font-semibold text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden /> Saved</span>}
            <Button type="submit" loading={isSaving} className="w-full sm:w-auto">
              <Save className="h-4 w-4" aria-hidden /> {isSaving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      </form>
    </AdminLayout>
  );
}
