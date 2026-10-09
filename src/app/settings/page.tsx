"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Save, CheckCircle2, CalendarDays, Upload, Trash2, Users, ChevronRight } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { VisibilityEditor } from "@/components/common/VisibilityEditor";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { isValidGstin } from "@/lib/tax";
import { cn } from "@/lib/utils";
import type { CustomerVisibility, NotificationSettings } from "@/lib/types";

const SECTIONS = [
  ["s-company", "Company"],
  ["s-logo", "Logo & signature"],
  ["s-gst", "GST"],
  ["s-invoice", "Invoices"],
  ["s-quote", "Quotations"],
  ["s-users", "Users"],
  ["s-portal", "Customer portal"],
  ["s-notify", "Notifications"],
] as const;

const NOTIFY_LABELS: Record<keyof NotificationSettings, { title: string; hint: string }> = {
  fieldManagerAssigned: { title: "Job assigned", hint: "Tell the Field Manager when a job is assigned to them" },
  customerArrived: { title: "Team arrived", hint: "Tell the customer when the team reaches the property" },
  qcReady: { title: "Ready for QC", hint: "Tell the QC Inspector when a job is ready to inspect" },
  reworkAssigned: { title: "Rework assigned", hint: "Tell the Field Manager when QC sends work back" },
  customerCompleted: { title: "Work completed", hint: "Send the customer their link when the work is done" },
};

const area = "w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm";
const section = "rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 space-y-4 scroll-mt-24";

/** Reads an image file and shrinks it so it stays small enough to print on every document. */
async function toSmallDataUrl(file: File, max = 600): Promise<string> {
  const src = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/png");
}

function ImageSetting({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-zinc-800">{label}</div>
      <div className="flex items-center gap-4">
        <div className="h-20 w-32 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 flex items-center justify-center overflow-hidden shrink-0">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img src={value} alt={`${label} preview`} className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-xs text-zinc-400">None</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Upload</Button>
          {value && <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}><Trash2 className="h-4 w-4 text-red-600" aria-hidden /> Remove</Button>}
        </div>
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setError(null);
          try {
            const url = await toSmallDataUrl(f);
            if (url.length > 400_000) return setError("That image is too large. Try a smaller one.");
            onChange(url);
          } catch {
            setError("Couldn't read that image. Use a PNG or JPEG.");
          }
        }}
      />
      {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Admin → Settings: configuration only. */
export default function SettingsPage() {
  const { systemSettings: s, updateSystemSettings, fontSize, setFontSize } = useApp();
  const { currentUser, can } = useAuth();

  const [companyName, setCompanyName] = useState(s.companyName || "");
  const [companyTagline, setCompanyTagline] = useState(s.companyTagline || "");
  const [companyAddress, setCompanyAddress] = useState(s.companyAddress || "");
  const [companyPhone, setCompanyPhone] = useState(s.companyPhone || "");
  const [companyEmail, setCompanyEmail] = useState(s.companyEmail || "");
  const [logo, setLogo] = useState(s.logoDataUrl || "");
  const [signature, setSignature] = useState(s.signatureDataUrl || "");
  const [signatoryName, setSignatoryName] = useState(s.signatoryName || "");
  const [taxRatePercent, setTaxRatePercent] = useState(String(s.taxRatePercent ?? 18));
  const [gstin, setGstin] = useState(s.gstin || "");
  const [sacCode, setSacCode] = useState(s.sacCode || "");
  const [invoicePaymentTerms, setInvoicePaymentTerms] = useState(s.invoicePaymentTerms || "");
  const [invoiceNotes, setInvoiceNotes] = useState(s.invoiceNotes || "");
  const [quotationTerms, setQuotationTerms] = useState(s.quotationTerms || "");
  const [quotationPaymentTerms, setQuotationPaymentTerms] = useState(s.quotationPaymentTerms || "");
  const [quotationValidityDays, setQuotationValidityDays] = useState(String(s.quotationValidityDays ?? 15));
  const [googleReviewUrl, setGoogleReviewUrl] = useState(s.googleBusinessReviewUrl || "");
  const [visibility, setVisibility] = useState<CustomerVisibility>(s.customerVisibility);
  const [notifications, setNotifications] = useState<NotificationSettings>(s.notifications);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Settings arrive after the first render — pick them up once they do.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = JSON.stringify(s);
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setCompanyName(s.companyName || "");
    setCompanyTagline(s.companyTagline || "");
    setCompanyAddress(s.companyAddress || "");
    setCompanyPhone(s.companyPhone || "");
    setCompanyEmail(s.companyEmail || "");
    setLogo(s.logoDataUrl || "");
    setSignature(s.signatureDataUrl || "");
    setSignatoryName(s.signatoryName || "");
    setTaxRatePercent(String(s.taxRatePercent ?? 18));
    setGstin(s.gstin || "");
    setSacCode(s.sacCode || "");
    setInvoicePaymentTerms(s.invoicePaymentTerms || "");
    setInvoiceNotes(s.invoiceNotes || "");
    setQuotationTerms(s.quotationTerms || "");
    setQuotationPaymentTerms(s.quotationPaymentTerms || "");
    setQuotationValidityDays(String(s.quotationValidityDays ?? 15));
    setGoogleReviewUrl(s.googleBusinessReviewUrl || "");
    setVisibility(s.customerVisibility);
    setNotifications(s.notifications);
  }, [s]);

  const [googleStatus, setGoogleStatus] = useState<{ connected: boolean; calendarEmail: string | null } | null>(null);
  useEffect(() => {
    if (!can("integrations.manage")) return;
    void fetch("/api/integrations/google")
      .then((r) => r.json())
      .then((j) => j?.success && setGoogleStatus(j.data))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.role]);

  const gstinError = gstin.trim() && !isValidGstin(gstin) ? "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5." : null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (gstinError) return setError(gstinError);
    setIsSaving(true);
    setError(null);
    const r = await updateSystemSettings({
      companyName: companyName.trim(),
      companyTagline: companyTagline.trim(),
      companyAddress: companyAddress.trim(),
      companyPhone: companyPhone.trim(),
      companyEmail: companyEmail.trim(),
      logoDataUrl: logo,
      signatureDataUrl: signature,
      signatoryName: signatoryName.trim(),
      taxRatePercent: Math.min(100, Math.max(0, Number(taxRatePercent) || 0)),
      gstin: gstin.trim().toUpperCase(),
      sacCode: sacCode.trim(),
      invoicePaymentTerms: invoicePaymentTerms.trim(),
      invoiceNotes: invoiceNotes.trim(),
      quotationTerms: quotationTerms.trim(),
      quotationPaymentTerms: quotationPaymentTerms.trim(),
      quotationValidityDays: Math.min(365, Math.max(1, Math.round(Number(quotationValidityDays) || 15))),
      googleBusinessReviewUrl: googleReviewUrl.trim(),
      customerVisibility: visibility,
      notifications,
    });
    setIsSaving(false);
    if (!r.success) return setError(r.message || "Couldn't save settings.");
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const Head = ({ id, title, hint }: { id: string; title: string; hint?: string }) => (
    <div>
      <h2 id={id + "-h"} className="text-lg font-semibold text-zinc-950">{title}</h2>
      {hint && <p className="text-sm text-zinc-500">{hint}</p>}
    </div>
  );

  return (
    <AdminLayout>
      <PageHeader title="Settings" description="Configuration only — company, documents, the customer portal and notifications." />

      <nav aria-label="Settings sections" className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1 max-w-3xl">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="shrink-0 min-h-10 inline-flex items-center px-3.5 rounded-full border border-zinc-300 bg-white text-sm font-medium text-zinc-700 hover:bg-zinc-50">{label}</a>
        ))}
      </nav>

      <form onSubmit={handleSave} className="max-w-3xl space-y-6 pb-28">
        <section id="s-company" className={section} aria-labelledby="s-company-h">
          <Head id="s-company" title="Company details" hint="Printed on quotations, invoices and the customer page." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company name" htmlFor="st-name"><Input id="st-name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>
            <Field label="Tagline" htmlFor="st-tag"><Input id="st-tag" value={companyTagline} onChange={(e) => setCompanyTagline(e.target.value)} /></Field>
          </div>
          <Field label="Address" htmlFor="st-addr"><textarea id="st-addr" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} rows={2} className={area} placeholder="Street, area, city, PIN" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Phone" htmlFor="st-phone"><Input id="st-phone" type="tel" inputMode="tel" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="+91 98765 43210" /></Field>
            <Field label="Email" htmlFor="st-email"><Input id="st-email" type="email" inputMode="email" value={companyEmail} onChange={(e) => setCompanyEmail(e.target.value)} placeholder="hello@yourcompany.com" /></Field>
          </div>
        </section>

        <section id="s-logo" className={section} aria-labelledby="s-logo-h">
          <Head id="s-logo" title="Logo & signature" hint="Shown on every quotation and invoice." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <ImageSetting id="st-logo" label="Company logo" hint="PNG or JPEG — a square logo works best." value={logo} onChange={setLogo} />
            <ImageSetting id="st-sign" label="Authorized signature" hint="A clear signature on a white background." value={signature} onChange={setSignature} />
          </div>
          <Field label="Signatory name" htmlFor="st-signame" hint="Printed under the signature"><Input id="st-signame" value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} /></Field>
        </section>

        <section id="s-gst" className={section} aria-labelledby="s-gst-h">
          <Head id="s-gst" title="GST details" hint="Used for new GST quotations and invoices. Existing invoices keep their figures." />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="GSTIN" htmlFor="st-gstin" error={gstinError}><Input id="st-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29AAACA9921K1Z2" maxLength={15} /></Field>
            <Field label="GST rate (%)" htmlFor="st-rate"><Input id="st-rate" type="number" inputMode="decimal" min={0} max={100} step="0.01" value={taxRatePercent} onChange={(e) => setTaxRatePercent(e.target.value)} /></Field>
            <Field label="SAC code" htmlFor="st-sac"><Input id="st-sac" value={sacCode} onChange={(e) => setSacCode(e.target.value)} placeholder="998533" /></Field>
          </div>
        </section>

        <section id="s-invoice" className={section} aria-labelledby="s-invoice-h">
          <Head id="s-invoice" title="Invoice settings" hint="Defaults printed on new invoices." />
          <Field label="Payment terms" htmlFor="st-ipay"><textarea id="st-ipay" value={invoicePaymentTerms} onChange={(e) => setInvoicePaymentTerms(e.target.value)} rows={2} className={area} /></Field>
          <Field label="Invoice notes" htmlFor="st-inotes"><textarea id="st-inotes" value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} rows={2} className={area} /></Field>
        </section>

        <section id="s-quote" className={section} aria-labelledby="s-quote-h">
          <Head id="s-quote" title="Quotation settings" hint="Defaults for new quotations." />
          <Field label="Valid for (days)" htmlFor="st-qdays" className="sm:max-w-[12rem]"><Input id="st-qdays" type="number" inputMode="numeric" min={1} max={365} value={quotationValidityDays} onChange={(e) => setQuotationValidityDays(e.target.value)} /></Field>
          <Field label="Payment terms" htmlFor="st-qpay"><textarea id="st-qpay" value={quotationPaymentTerms} onChange={(e) => setQuotationPaymentTerms(e.target.value)} rows={2} className={area} /></Field>
          <Field label="Terms & conditions" htmlFor="st-qterms"><textarea id="st-qterms" value={quotationTerms} onChange={(e) => setQuotationTerms(e.target.value)} rows={4} className={area} /></Field>
        </section>

        <section id="s-users" className={section} aria-labelledby="s-users-h">
          <Head id="s-users" title="Users & permissions" hint="Who can sign in and what each role can do." />
          <Link href="/users" className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 py-3 hover:bg-zinc-50">
            <Users className="h-5 w-5 text-zinc-400" aria-hidden />
            <span className="flex-1 text-sm font-semibold text-zinc-900">Manage users and roles</span>
            <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden />
          </Link>
        </section>

        <section id="s-portal" className={section} aria-labelledby="s-portal-h">
          <Head id="s-portal" title="Customer portal" hint="What customers see when they scan the QR. Each job can override this. Hidden items are never sent to the customer." />
          <VisibilityEditor value={visibility} onChange={setVisibility} />
          <Field label="Google review link" hint="After approving, customers see a “Leave Google review” button. Leave empty to hide it." htmlFor="st-review">
            <Input id="st-review" type="url" inputMode="url" value={googleReviewUrl} onChange={(e) => setGoogleReviewUrl(e.target.value)} placeholder="https://g.page/r/…/review" />
          </Field>
        </section>

        <section id="s-notify" className={section} aria-labelledby="s-notify-h">
          <Head id="s-notify" title="Notification settings" hint="Which automatic messages are sent." />
          <ul className="space-y-2">
            {(Object.keys(NOTIFY_LABELS) as (keyof NotificationSettings)[]).map((k) => {
              const on = notifications[k];
              return (
                <li key={k}>
                  <button type="button" role="switch" aria-checked={on} onClick={() => setNotifications((n) => ({ ...n, [k]: !on }))} className="w-full min-h-14 rounded-xl border border-zinc-200 px-4 py-2.5 flex items-center gap-3 text-left hover:bg-zinc-50">
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-zinc-900">{NOTIFY_LABELS[k].title}</span>
                      <span className="block text-xs text-zinc-500">{NOTIFY_LABELS[k].hint}</span>
                    </span>
                    <span aria-hidden className={cn("relative h-6 w-11 rounded-full transition-colors shrink-0", on ? "bg-emerald-500" : "bg-zinc-300")}>
                      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[1.375rem]" : "left-0.5")} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className={section} aria-labelledby="s-text-h">
          <Head id="s-text" title="Text size" hint="Makes everything easier to read on this device." />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Text size">
            {([["sm", "Small"], ["md", "Normal"], ["lg", "Large"], ["xl", "Extra large"]] as const).map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={fontSize === k} onClick={() => setFontSize(k)} className={fontSize === k ? "h-12 rounded-xl border-2 border-rose-500 bg-rose-50 text-sm font-semibold text-rose-700" : "h-12 rounded-xl border border-zinc-200 bg-white text-sm font-medium text-zinc-700"}>
                {l}
              </button>
            ))}
          </div>
        </section>

        {can("integrations.manage") && (
          <section className={section} aria-labelledby="s-int-h">
            <Head id="s-int" title="Integrations" />
            <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-4 py-3">
              <span className="flex items-center gap-3 min-w-0">
                <CalendarDays className="h-5 w-5 text-zinc-400 shrink-0" aria-hidden />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-950">Google Calendar</span>
                  <span className="block text-sm text-zinc-500 truncate">{googleStatus?.connected ? `Jobs sync to ${googleStatus.calendarEmail ?? "your calendar"}` : "Not connected — ask your developer to connect it."}</span>
                </span>
              </span>
              <span className={googleStatus?.connected ? "shrink-0 rounded-full bg-emerald-50 text-emerald-800 px-2.5 py-1 text-xs font-semibold" : "shrink-0 rounded-full bg-zinc-100 text-zinc-600 px-2.5 py-1 text-xs font-semibold"}>
                {googleStatus?.connected ? "Connected" : "Off"}
              </span>
            </div>
          </section>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 lg:left-64 z-30 bg-white/95 backdrop-blur border-t border-zinc-200 px-4 py-3">
          <div className="max-w-3xl mx-auto lg:mx-8 flex items-center justify-end gap-3">
            {saved && <span role="status" className="text-sm font-semibold text-emerald-700 inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden /> Saved</span>}
            <Button type="submit" loading={isSaving} className="w-full sm:w-auto">
              <Save className="h-4 w-4" aria-hidden /> {isSaving ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </div>
      </form>
    </AdminLayout>
  );
}
