"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Loader2, Lock, Mail, ArrowRight, AlertCircle, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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

  const handleDemoLogin = async (demoEmail: string, label: string) => {
    setError(null);
    setDemoBusy(demoEmail);
    const result = await login(demoEmail, DEMO_PASSWORD);
    if (!result.success) {
      setError(result.message || `Could not sign in as ${label}.`);
    }
    setDemoBusy(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Brand gradient wash — echoes the site's coral→maroon hero overlay */}
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-br from-rose-500/15 via-rose-900/10 to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-rose-500/10 to-transparent pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center relative">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-lg bg-white p-3 shadow-sm border border-rose-100 mb-4 overflow-hidden">
          <img src="/logo.png" alt="Company Logo" className="h-full w-full object-contain" />
        </div>
        <div className="mx-auto mb-3 h-1 w-16 rounded-full bg-gradient-to-r from-rose-500 to-rose-600" />
        <h2 className="text-2xl font-semibold tracking-tight text-rose-600 font-sans">
          Intense Care Operations ERP
        </h2>
        <p className="mt-1.5 text-xs text-slate-600 max-w-sm mx-auto leading-relaxed">
          Enterprise deep cleaning operations management. Sign in with your work account.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative">
        <div className="bg-white py-8 px-4 border border-slate-200 sm:rounded-lg shadow-sm sm:px-10 space-y-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Email Address</label>
              <div className="relative">
                <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="pl-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Password</label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pl-9 text-xs"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full text-white text-xs h-10 shadow-sm font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Signing In…
                </>
              ) : (
                <>
                  Sign In to Workspace
                  <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                </>
              )}
            </Button>
          </form>
        </div>

        {/* Client demo: one-click sign-in for every role */}
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => setDemoOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-rose-600 transition-colors"
          >
            <Users className="h-3.5 w-3.5" />
            {demoOpen ? "Hide demo role logins" : "Demo: sign in as a role"}
            <svg
              className={`h-3.5 w-3.5 transition-transform ${demoOpen ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.23 8.27a.75.75 0 01.02-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {demoOpen && (
            <div className="mt-3 bg-white border border-slate-200 rounded-lg shadow-sm p-3 grid grid-cols-3 gap-1.5 text-left">
              {DEMO_ACCOUNTS.map((acct) => (
                <button
                  key={acct.role}
                  type="button"
                  disabled={demoBusy !== null}
                  onClick={() => handleDemoLogin(acct.email, acct.label)}
                  title={acct.email}
                  className="px-2 py-2 rounded-md border border-slate-200 bg-slate-50 hover:bg-rose-50 hover:border-rose-200 transition-colors text-[10px] leading-tight font-medium text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {demoBusy === acct.email ? (
                    <Loader2 className="h-3 w-3 animate-spin mx-auto" />
                  ) : (
                    acct.label
                  )}
                </button>
              ))}
              <div className="col-span-3 pt-1 text-[10px] text-slate-400">
                One-click demo accounts — every role uses the password{" "}
                <code className="font-mono">intense123</code>.
              </div>
            </div>
          )}
        </div>

        <div className="text-center mt-5 text-xs text-slate-500">
          <p>Accounts are provisioned by your administrator.</p>
          <p className="mt-1">
            Customers sign off jobs via secure token links without needing an account.
          </p>
        </div>
      </div>
    </div>
  );
}
