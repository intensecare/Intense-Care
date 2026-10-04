"use client";

import React, { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Loader2, Lock, Mail, ArrowRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
  };  return (
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

        <div className="text-center mt-6 text-xs text-slate-500">
          <p>Accounts are provisioned by your administrator.</p>
          <p className="mt-1">
            Customers sign off jobs via secure token links without needing an account.
          </p>
        </div>
      </div>
    </div>
  );
}
