"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2, ShieldCheck, AlertTriangle, LinkIcon, RefreshCw } from "lucide-react";

/**
 * /q/[token] — §29 QR scanning UX.
 *
 * "QR VERIFIED ✓ → routing…" then an automatic redirect to the scope the
 * server derived from the token (customer / manager / qc / approval / rework).
 * Invalid/expired/revoked states get the exact §29 copy and a re-request CTA.
 */
export default function QrLandingPage() {
  const params = useParams();
  const router = useRouter();
  const token = (params?.token as string) || "";
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/q/${encodeURIComponent(token)}`);
        const json = await res.json();
        if (cancelled) return;
        if (res.ok && json?.success) {
          setState("ok");
          const { scope, purpose } = json.data;
          setTimeout(() => {
            if (cancelled) return;
            if (scope === "manager") router.replace(`/manager/job/${token}`);
            else if (scope === "qc") router.replace(`/qc/job/${token}`);
            else if (scope === "approval") router.replace(`/approval/${token}`);
            else if (scope === "rework") router.replace(`/rework/${token}`);
            else router.replace(`/customer/job/${token}?purpose=${purpose}`);
          }, 450);
        } else {
          setKind(json?.kind || "not_found");
          setMessage(json?.error || "This QR code is invalid or has expired.");
          setState("error");
        }
      } catch {
        if (!cancelled) {
          setMessage("Network error while verifying the QR code. Please check your connection and retry.");
          setState("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      {state === "loading" && (
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-rose-500 mx-auto" />
          <p className="text-sm font-medium text-slate-600">Verifying QR code…</p>
        </div>
      )}

      {state === "ok" && (
        <div className="text-center space-y-4">
          <div className="h-16 w-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto">
            <ShieldCheck className="h-8 w-8 text-emerald-600" />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">QR VERIFIED ✓</p>
            <p className="text-xs text-slate-500 mt-1 flex items-center justify-center gap-1.5">
              <Loader2 className="h-3 w-3 animate-spin" /> Opening your secure workflow…
            </p>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="bg-white p-8 rounded-2xl shadow-md border border-slate-200 text-center max-w-md w-full space-y-4">
          <div
            className={`h-14 w-14 rounded-full flex items-center justify-center mx-auto ${
              kind === "revoked" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
            }`}
          >
            {kind === "revoked" ? <LinkIcon className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
          </div>
          <h2 className="text-xl font-semibold text-slate-900">
            {kind === "revoked" ? "This link is no longer active." : "This QR code is invalid or expired."}
          </h2>
          <p className="text-sm text-slate-600">{message}</p>
          {kind === "wrong_status" ? (
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
              You don't have permission to access this job with this link. Please contact our support team for a fresh
              link.
            </p>
          ) : (
            <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
              <RefreshCw className="h-3.5 w-3.5" />
              Request a new link from your service manager or support team.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
