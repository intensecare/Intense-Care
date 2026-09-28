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
  };

  return (
    <div className="min-h-screen bg-zinc-50/70 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50/60 p-2.5 shadow-xs border border-rose-200/80 mb-3 overflow-hidden">
          <img src="/logo.png" alt="Company Logo" className="h-full w-full object-contain" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-zinc-900 uppercase font-sans">
          Intense Care Operations ERP
        </h2>
        <p className="mt-1 text-xs text-zinc-500 max-w-sm mx-auto leading-relaxed">
          Enterprise deep cleaning operations management. Sign in with your work account.
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 border border-zinc-200 sm:rounded-xl shadow-xs sm:px-10 space-y-6">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-700">Email Address</label>
              <div className="relative">
                <Mail className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="pl-9 text-xs focus-visible:ring-rose-500 focus-visible:border-rose-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-700">Password</label>
              <div className="relative">
                <Lock className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="pl-9 text-xs focus-visible:ring-rose-500 focus-visible:border-rose-500"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-2.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full bg-rose-600 hover:bg-rose-700 text-white text-xs h-9 shadow-xs font-bold"
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

        <div className="text-center mt-6 text-xs text-zinc-500">
          <p>Accounts are provisioned by your administrator.</p>
          <p className="mt-1">
            Customers sign off jobs via secure token links without needing an account.
          </p>
        </div>
      </div>
    </div>
  );
}
