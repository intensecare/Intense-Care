"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import {
  Save,
  CheckCircle2,
  Database,
  ShieldCheck,
  RefreshCw,
  Loader2,
  CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { SmsGatewayLog } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function SettingsPage() {
  const {
    systemSettings,
    updateSystemSettings,
    fontSize,
    setFontSize,
    smsGatewayLogs,
    fetchSmsGatewayLog,
  } = useApp();
  const { currentUser } = useAuth();

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
    if (currentUser?.role === "super_admin") void checkGoogleStatus();
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

  return (
    <AdminLayout>
      <PageHeader
        title="Settings & System Configuration"
        description="Operational configuration, tax parameters, accessibility options, and gateway health."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Settings" },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Signed-in identity */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-slate-900" />
                Session Identity
              </h3>
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 text-[11px] space-y-1">
              <div className="flex justify-between text-slate-600">
                <span>Signed in as:</span>
                <span className="font-semibold text-slate-900">{currentUser?.name}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Email:</span>
                <span className="font-mono text-slate-800">{currentUser?.email}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Role:</span>
                <span className="font-semibold text-slate-800">
                  {currentUser?.role.replace("_", " ")}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Authentication is database-backed (bcrypt password verification). Accounts are
              provisioned by administrators in Users &amp; Roles.
            </p>
          </div>

          {/* §1 Google Integrations — Connected / Not Connected */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <CalendarDays className="h-4 w-4 text-slate-900" />
                Integrations
              </h3>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px] gap-1"
                disabled={googleChecking}
                onClick={() => void checkGoogleStatus()}
              >
                <RefreshCw className={`h-3 w-3 ${googleChecking ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {googleStatus === null ? (
              <p className="text-[11px] text-slate-400">Checking integration status…</p>
            ) : (
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Google Calendar</span>
                  {googleStatus.connected ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Connected
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                      Not Connected
                    </span>
                  )}
                </div>
                {googleStatus.connected ? (
                  <div className="space-y-0.5 text-slate-600">
                    <div>Calendar account: <strong className="font-mono">{googleStatus.calendarEmail || "primary"}</strong></div>
                    <div>
                      Every job syncs as one calendar event (customer, service, time, address, team,
                      contact &amp; job id); updates refresh it and cancellations cancel it.
                    </div>
                    {googleStatus.lastSyncAt && <div>Last sync: {formatDateTime(googleStatus.lastSyncAt)}</div>}
                  </div>
                ) : (
                  <div className="space-y-1 text-slate-500 leading-relaxed">
                    <p>Connect by adding these environment variables (Vercel → Project → Settings → Environment Variables):</p>
                    <code className="block font-mono text-[10px] bg-slate-100 rounded px-2 py-1 text-slate-700">
                      GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · GOOGLE_REFRESH_TOKEN · GOOGLE_CALENDAR_ID (optional)
                    </code>
                    <p>
                      The refresh token needs the <span className="font-mono">calendar.events</span> scope.
                      Once present, bookings appear on the connected calendar automatically.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Gateway health */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Database className="h-4 w-4 text-slate-900" />
                SMS Gateway Health
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                {smsGatewayLogs.length} dispatches
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80 text-[11px] space-y-1 max-h-40 overflow-y-auto">
              {smsGatewayLogs.length === 0 ? (
                <span className="text-slate-400">No dispatches recorded yet.</span>
              ) : (
                smsGatewayLogs.slice(0, 10).map((log: SmsGatewayLog) => (
                  <div key={log.id} className="flex justify-between text-slate-600">
                    <span className="font-mono truncate">{log.jobId || "—"} · {log.recipientMasked}</span>
                    <span
                      className={`font-semibold ${
                        log.status === "SENT"
                          ? "text-emerald-700"
                          : log.status === "FAILED"
                          ? "text-red-700"
                          : "text-amber-700"
                      }`}
                    >
                      {log.status}
                    </span>
                  </div>
                ))
              )}
            </div>
            <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => void fetchSmsGatewayLog()}>
              Refresh Gateway Log
            </Button>
          </div>

          {/* Typography & Font Size Accessibility (Govt Website Style) */}
          <div className="bg-white rounded-lg border border-zinc-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5 font-sans">
                Accessibility Font Size Scaler
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-100 text-zinc-900 font-semibold border border-zinc-300">
                Govt Portal Style
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 pt-1 font-mono">
              <button
                type="button"
                onClick={() => setFontSize("sm")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "sm"
                    ? "bg-rose-500 text-white border-rose-500 font-semibold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-semibold">-A</span>
                <span className="text-[10px]">Compact</span>
              </button>

              <button
                type="button"
                onClick={() => setFontSize("md")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "md"
                    ? "bg-rose-500 text-white border-rose-500 font-semibold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-semibold">A</span>
                <span className="text-[10px]">Standard</span>
              </button>

              <button
                type="button"
                onClick={() => setFontSize("lg")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "lg"
                    ? "bg-rose-500 text-white border-rose-500 font-semibold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-semibold">+A</span>
                <span className="text-[10px]">Large</span>
              </button>

              <button
                type="button"
                onClick={() => setFontSize("xl")}
                className={`p-3 rounded border text-center transition-all flex flex-col items-center gap-1 ${
                  fontSize === "xl"
                    ? "bg-rose-500 text-white border-rose-500 font-semibold"
                    : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                }`}
              >
                <span className="text-base font-semibold">++A</span>
                <span className="text-[10px]">X-Large</span>
              </button>
            </div>
          </div>
        </div>

        {/* Platform Settings Form */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-semibold text-slate-500">
              Operational Configuration
            </h3>

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="p-3 rounded-md bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                <strong>Security notice:</strong> notification cooldowns and SMS
                rate caps are enforced <strong>server-side</strong> from environment variables (see{" "}
                <code className="font-mono bg-amber-100 px-1 rounded">.env.example</code>). Values below
                are operational display defaults only and do not weaken gateway security.
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="text-[11px] font-semibold text-slate-500">
                  Company Profile (printed on tax invoices &amp; statements)
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Company Name</label>
                    <Input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="e.g. Intense Care"
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Business Line / Tagline</label>
                    <Input
                      type="text"
                      value={companyTagline}
                      onChange={(e) => setCompanyTagline(e.target.value)}
                      placeholder="e.g. Deep Cleaning Field Services"
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Registered Address</label>
                  <Input
                    type="text"
                    value={companyAddress}
                    onChange={(e) => setCompanyAddress(e.target.value)}
                    placeholder="Street, locality, city, state, PIN"
                    className="text-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Support Phone</label>
                    <Input
                      type="text"
                      value={companyPhone}
                      onChange={(e) => setCompanyPhone(e.target.value)}
                      placeholder="e.g. +91 98765 43210"
                      className="text-xs font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="font-semibold text-slate-700">Support / Billing Email</label>
                    <Input
                      type="email"
                      value={companyEmail}
                      onChange={(e) => setCompanyEmail(e.target.value)}
                      placeholder="e.g. billing@yourcompany.com"
                      className="text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">
                  Next-Day Job Dispatch Time (24h Format)
                </label>
                <Input
                  type="time"
                  value={nextDayDispatchTime}
                  onChange={(e) => setNextDayDispatchTime(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[10px] text-slate-400">
                  Default 20:00 (8:00 PM). Operations Manager sees next day's job queue starting at this time.
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Notification Resend Cooldown (Seconds)</label>
                <Input
                  type="number"
                  value={resendCooldownSeconds}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setResendCooldownSeconds(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="text-xs"
                />
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="text-[11px] font-semibold text-slate-500">
                  Taxation (GST)
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Tax Rate (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={taxRatePercent}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setTaxRatePercent(e.target.value === "" ? 0 : Number(e.target.value))}
                    className="text-xs"
                  />
                  <p className="text-[10px] text-slate-400">
                    Applied to new invoices and quotes. Set 0 to disable tax. Already-issued invoices keep their original figures.
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Tax Label (printed on invoices)</label>
                  <Input
                    type="text"
                    value={taxLabel}
                    onChange={(e) => setTaxLabel(e.target.value)}
                    placeholder="GST"
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Business GSTIN (printed on invoices)</label>
                  <Input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value)}
                    placeholder="e.g. 29AAACA9921K1Z2"
                    className="text-xs font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">SAC Code (printed on invoices)</label>
                  <Input
                    type="text"
                    value={sacCode}
                    onChange={(e) => setSacCode(e.target.value)}
                    placeholder="e.g. 998533"
                    className="text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-1">
                <label className="font-semibold text-slate-700">
                  Google Business Profile Review Link
                </label>
                <Input
                  value={googleReviewUrl}
                  onChange={(e) => setGoogleReviewUrl(e.target.value)}
                  className="text-xs font-mono"
                />
                <p className="text-[10px] text-slate-400">
                  Official review URL provided to customers upon completion (ungated). Leave empty to hide the prompt.
                </p>
              </div>

              <div className="pt-2">
                <Button type="submit" size="sm" className="w-full bg-slate-900 text-white" disabled={isSaving}>
                  {isSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      Save Settings
                    </>
                  )}
                </Button>
                {savedSuccess && (
                  <p className="text-[11px] text-emerald-700 font-semibold text-center mt-2 flex items-center justify-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Configuration saved!
                  </p>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
