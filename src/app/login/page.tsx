"use client";

import React, { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Lock, Mail, AlertCircle, Loader2, ShieldCheck, Smartphone, ClipboardCheck, Receipt, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

type DemoAccount = { role: string; label: string };

const DEMO_ICON: Record<string, React.ElementType> = {
  admin: ShieldCheck,
  field_manager: Smartphone,
  qc_inspector: ClipboardCheck,
  tax_officer: Receipt,
  customer: QrCode,
};
const DEMO_HINT: Record<string, string> = {
  admin: "Runs the business",
  field_manager: "Does the work on site",
  qc_inspector: "Checks the work",
  tax_officer: "GST invoices only",
  customer: "Opens the job QR page",
};

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Demo sign-in: shown only when the server has it switched on.
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/demo-login", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => j?.data?.enabled && setDemo(j.data.accounts ?? []))
      .catch(() => {});
  }, []);

  const demoLogin = async (role: string) => {
    setError(null);
    setDemoBusy(role);
    try {
      const res = await fetch("/api/auth/demo-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setError(json?.error || "Demo sign-in failed. Please try again.");
        setDemoBusy(null);
        return;
      }
      // Full page load so the app starts fresh in the demo role's workspace.
      window.location.assign(json.data.redirect);
    } catch {
      setError("You're offline. Check your connection and try again.");
      setDemoBusy(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;

    setError(null);
    setSubmitting(true);
    const result = await login(email.trim(), password);
    if (!result.success) {
      setError(result.message || "Invalid email or password.");
    }
    setSubmitting(false);
  };

  return (
    <main className="min-h-dvh bg-zinc-50 flex flex-col justify-center px-4 py-10">
      <div className="mx-auto w-full max-w-sm">
        <div className="text-center">
          <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-3 shadow-sm border border-zinc-200 overflow-hidden">
            <img src="/logo.png" alt="" className="h-full w-full object-contain" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950">Intense Care</h1>
          <p className="mt-1 text-sm text-zinc-600">Sign in with your work account.</p>
        </div>

        <form onSubmit={handleLogin} className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 sm:p-6 shadow-sm space-y-4" noValidate>
          <Field label="Email" required htmlFor="login-email">
            <div className="relative">
              <Mail className="h-5 w-5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden />
              <Input
                id="login-email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="pl-11"
              />
            </div>
          </Field>

          <Field label="Password" required htmlFor="login-password">
            <div className="relative">
              <Lock className="h-5 w-5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" aria-hidden />
              <Input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="pl-11"
              />
            </div>
          </Field>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3 text-sm text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={!email.trim() || !password}>
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          No account? Ask your administrator.
        </p>

        {demo.length > 0 && (
          <section aria-labelledby="demo-title" className="mt-8">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-zinc-200" aria-hidden />
              <h2 id="demo-title" className="text-sm font-semibold text-zinc-600">Try a demo</h2>
              <span className="h-px flex-1 bg-zinc-200" aria-hidden />
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-2">
              {demo.map((a) => {
                const Icon = DEMO_ICON[a.role] ?? ShieldCheck;
                const busy = demoBusy === a.role;
                return (
                  <li key={a.role}>
                    <button
                      type="button"
                      onClick={() => void demoLogin(a.role)}
                      disabled={!!demoBusy}
                      className="w-full min-h-14 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 flex items-center gap-3 text-left hover:border-rose-300 hover:bg-rose-50/50 disabled:opacity-60"
                    >
                      <span className="h-9 w-9 rounded-lg bg-zinc-100 text-zinc-700 flex items-center justify-center shrink-0">
                        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-base font-semibold text-zinc-950">{a.role === "customer" ? "Customer" : `Sign in as ${a.label}`}</span>
                        <span className="block text-sm text-zinc-500">{DEMO_HINT[a.role]}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-center text-xs text-zinc-500">Demo accounts use sample data.</p>
          </section>
        )}
      </div>
    </main>
  );
}
