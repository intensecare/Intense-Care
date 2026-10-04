"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Job } from "@/lib/types";
import { useApp } from "@/lib/app-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ShieldCheck, KeyRound, AlertCircle, RefreshCw, Smartphone, CheckCircle2, Loader2 } from "lucide-react";

interface OTPModalProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

/** Shape returned by GET /api/jobs/[id] (server-authoritative OTP truth). */
interface JobOtpState {
  otp: {
    hasPendingChallenge: boolean;
    verified: boolean;
    attemptsUsed: number;
    maxAttempts: number;
    expiresAt: string | null;
    status: string;
    sentToLast4: string | null;
  };
}

/**
 * Customer arrival OTP entry.
 *
 * The plaintext code NEVER exists on the client — the provider generates and
 * delivers it by SMS. Opening the modal dispatches the OTP server-side (if not
 * already sent/verified), and every verify/resend re-reads the authoritative
 * attempt/expiry state from GET /api/jobs/[id].
 */
export function OTPModal({ job, isOpen, onClose, onSuccess }: OTPModalProps) {
  const { verifyJobOTP, sendJobArrivalOTP, resendJobOTP } = useApp();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentToLast4, setSentToLast4] = useState<string | null>(job.otpVerification.sentToLast4 ?? null);
  const [attemptsUsed, setAttemptsUsed] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(job.otpVerification.maxAttempts || 5);
  const [devCode, setDevCode] = useState<string | null>(null);

  // Resend cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  /** Pulls authoritative OTP state (attempts, last-4, verified) from the server. */
  const refreshOtpState = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}`);
      const json = (await res.json().catch(() => null)) as { success: boolean; data?: JobOtpState } | null;
      if (json?.success && json.data?.otp) {
        const o = json.data.otp;
        setSentToLast4(o.sentToLast4);
        setAttemptsUsed(o.attemptsUsed);
        setMaxAttempts(o.maxAttempts || 5);
        if (o.verified) {
          // Another session verified while the modal was open — reflect it.
          setInfo("OTP already verified. You can start the job.");
        }
      }
    } catch {
      // Non-fatal: local counters stay as-is until the next action.
    }
  }, [job.id]);

  // Opening the modal triggers the actual SMS dispatch (idempotent server-side:
  // cooldown + already-verified guards run there).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsSending(true);
    setError(null);
    setInfo(null);
    setDevCode(null);
    (async () => {
      const res = await sendJobArrivalOTP(job.id);
      if (cancelled) return;
      setIsSending(false);
      if (res.success) {
        setInfo(res.message);
        setCooldown(res.cooldownSeconds ?? 60);
        if (res.maskedPhone) setSentToLast4(res.maskedPhone.replace(/\D/g, "").slice(-4));
        if (res.devCode) setDevCode(res.devCode);
      } else if (res.message.includes("already verified")) {
        setInfo(res.message);
      } else {
        // Cooldown mid-window still means a code is in flight — not fatal.
        if (res.message.includes("wait")) {
          setInfo("An OTP is already on its way. Ask the customer for the code.");
          const m = res.message.match(/(\d+)s/);
          if (m) setCooldown(Number.parseInt(m[1], 10));
        } else {
          setError(res.message);
        }
      }
      void refreshOtpState();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, job.id]);

  const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || code.trim().length !== 6) {
      setError("Please enter the complete 6-digit verification code");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setInfo(null);

    const result = await verifyJobOTP(job.id, code.trim());
    setIsSubmitting(false);

    if (result.success) {
      setCode("");
      onClose();
      if (onSuccess) onSuccess();
    } else {
      setError(result.message);
      setCode("");
      void refreshOtpState();
    }
  };

  const handleResend = async () => {
    setIsResending(true);
    setError(null);
    setInfo(null);

    const res = await resendJobOTP(job.id);
    setIsResending(false);

    if (res.success) {
      setInfo(res.message);
      setCooldown(res.cooldownSeconds ?? 60);
      setCode("");
      if (res.maskedPhone) setSentToLast4(res.maskedPhone.replace(/\D/g, "").slice(-4));
      if (res.devCode) setDevCode(res.devCode);
    } else {
      setError(res.message);
    }
    void refreshOtpState();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-800 mb-2 border border-slate-200">
            <KeyRound className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center text-lg">
            Customer Arrival Verification
          </DialogTitle>
          <DialogDescription className="text-center text-xs leading-relaxed">
            Ask the customer for the 6-digit OTP sent to their registered mobile. Work cannot commence until the server verifies it.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleVerify} className="space-y-4 py-2">
          {devCode && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
              <span className="font-semibold">DEV MODE —</span> no SMS sent. OTP:{" "}
              <span className="font-mono text-base font-semibold tracking-widest">{devCode}</span>
            </div>
          )}
          <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-xs space-y-1">
            <div className="flex items-center justify-between font-medium text-slate-700">
              <span className="flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-slate-500" />
                OTP sent via SMS to
              </span>
              <span className="font-mono text-slate-900">
                {isSending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                ) : sentToLast4 ? (
                  `******${sentToLast4}`
                ) : (
                  "registered number"
                )}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-500 text-[11px]">
              <span>Attempts remaining:</span>
              <span className="font-semibold text-slate-700">
                {attemptsRemaining} of {maxAttempts}
              </span>
            </div>
          </div>

          {/* OTP Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">
              Enter 6-Digit OTP
            </label>
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="• • • • • •"
              className="text-center text-xl tracking-[0.5em] font-mono font-semibold h-12"
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="flex items-start gap-2 p-2.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{info}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending || isSending || cooldown > 0}
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:underline transition-colors disabled:opacity-50 disabled:hover:no-underline"
            >
              <RefreshCw className={`h-3 w-3 ${isResending ? "animate-spin" : ""}`} />
              {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend OTP via SMS"}
            </button>

            <span className="text-[11px] text-slate-400">
              Secured & verified server-side
            </span>
          </div>

          <DialogFooter className="mt-4 pt-2 border-t border-slate-100 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || isSending || code.length !== 6}
              className="bg-rose-500 hover:bg-rose-600 text-white shadow-sm"
            >
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              {isSubmitting ? "Verifying..." : "Verify & Unlock Job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
