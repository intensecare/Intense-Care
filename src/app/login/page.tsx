"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Lock, Mail, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

/** One demo account per role. Provisioned by .e2e-tmp/demo-accounts.mjs. */
const DEMO_ACCOUNTS = [
  { role: "super_admin", label: "Super Admin", email: "pahima@intensecare.com" },
  { role: "ops_manager", label: "Operations", email: "ops.demo@intensecare.com" },
  { role: "scheduler", label: "Scheduler", email: "scheduler.demo@intensecare.com" },
  { role: "field_manager", label: "Field Manager", email: "fieldmgr.demo@intensecare.com" },
  { role: "field_staff", label: "Field Staff", email: "field.demo@intensecare.com" },
  { role: "qc_inspector", label: "Quality", email: "qc.demo@intensecare.com" },
  { role: "accounts", label: "Accounts", email: "accounts.demo@intensecare.com" },
  { role: "referral_partner", label: "Partner", email: "sneha.demo@intensecare.com" },
  { role: "customer", label: "Customer", email: "rishab.demo@intensecare.com" },
] as const;

const DEMO_PASSWORD = "intense123";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);

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
      </div>
    </main>
  );
}
