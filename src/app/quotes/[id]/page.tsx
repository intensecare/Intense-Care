"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Briefcase, CheckCircle2, ChevronLeft, Send, Trash2, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { PromptModal } from "@/components/common/PromptModal";
import { DocumentActions } from "@/components/common/DocumentActions";
import { QuoteDocument, useQuoteDetail } from "@/components/documents/QuoteDocument";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { ErrorState, Notice, Skeleton } from "@/components/ui/states";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApp } from "@/lib/app-context";
import { toLocalDateOffset } from "@/lib/utils";

/**
 * §4 Admin → one quotation: the printable document plus the three decisions
 * that move it along — send, record acceptance, convert into a job.
 */
export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useQuoteDetail(id);
  const { users, refreshJobs } = useApp();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const act = async (body: Record<string, unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setNotice({ tone: "error", text: json?.error || "That did not go through." });
        return null;
      }
      setNotice({ tone: "success", text: success });
      await reload();
      return json.data as Record<string, unknown>;
    } catch {
      setNotice({ tone: "error", text: "You are offline. Check your connection and try again." });
      return null;
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <AdminLayout>
        <ErrorState message={error} onRetry={() => void reload()} />
      </AdminLayout>
    );
  if (loading && !data)
    return (
      <AdminLayout>
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-96" />
        </div>
      </AdminLayout>
    );
  if (!data) return null;

  const q = data.quote;
  const open = q.status === "draft" || q.status === "sent";
  const converted = q.status === "converted_to_job";

  return (
    <AdminLayout>
      <div className="print-hide space-y-4 mb-6">
        <Link
          href="/quotes"
          className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden /> Quotations
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 font-mono break-all">
            {q.quoteNumber}
          </h1>
          <div className="flex flex-wrap gap-2">
            {open && (
              <Button variant="outline" onClick={() => void act({ action: "send" }, "Marked as sent to the customer.")} disabled={busy}>
                <Send className="h-4 w-4" aria-hidden /> Mark as sent
              </Button>
            )}
            {!converted && !q.acceptedAt && (
              <Button onClick={() => setAcceptOpen(true)} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" aria-hidden /> Record acceptance
              </Button>
            )}
            {!converted && (
              <Button variant="success" onClick={() => setConvertOpen(true)} disabled={busy}>
                <Briefcase className="h-4 w-4" aria-hidden /> Convert to job
              </Button>
            )}
            {converted && q.jobId && (
              <Button variant="outline" onClick={() => router.push(`/jobs/${q.jobId}`)}>
                <Briefcase className="h-4 w-4" aria-hidden /> Open job {q.jobNumber ?? ""}
              </Button>
            )}
          </div>
        </div>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {!converted && (
          <div className="flex flex-wrap gap-2">
            {q.status !== "declined" && (
              <Button variant="ghost" onClick={() => setDeclineOpen(true)} disabled={busy}>
                <XCircle className="h-4 w-4" aria-hidden /> Mark as declined
              </Button>
            )}
            <Button variant="ghost" className="text-red-700" onClick={() => setDeleteOpen(true)} disabled={busy}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          </div>
        )}

        <DocumentActions
          title={`Quotation ${q.quoteNumber}`}
          shareText={`Quotation ${q.quoteNumber} for ${data.customer.name}`}
        />
      </div>

      <QuoteDocument detail={data} />

      <AcceptDialog
        open={acceptOpen}
        onClose={() => setAcceptOpen(false)}
        busy={busy}
        onConfirm={async (name) => {
          const done = await act({ action: "accept", acceptedBy: name }, "Acceptance recorded on the quotation.");
          if (done) setAcceptOpen(false);
        }}
      />

      <ConvertDialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        busy={busy}
        managers={users.filter((u) => u.role === "field_manager" && u.active).map((u) => ({ id: u.id, name: u.name }))}
        onConfirm={async (payload) => {
          const done = await act({ action: "convert", ...payload }, "Job created from this quotation.");
          if (done) {
            setConvertOpen(false);
            await refreshJobs();
            if (typeof done.jobId === "string") router.push(`/jobs/${done.jobId}`);
          }
        }}
      />

      <PromptModal
        isOpen={declineOpen}
        onClose={() => setDeclineOpen(false)}
        onSubmit={async (reason) => {
          await act({ action: "decline", reason }, "Quotation marked as declined.");
          setDeclineOpen(false);
        }}
        title="Mark this quotation as declined?"
        description="The reason is recorded against the quotation so the register stays honest."
        placeholder="e.g. Customer chose another provider"
        confirmText="Mark declined"
      />

      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          const res = await fetch(`/api/quotes/${encodeURIComponent(id)}`, { method: "DELETE" });
          const json = await res.json().catch(() => null);
          setBusy(false);
          setDeleteOpen(false);
          if (!res.ok || !json?.success) {
            setNotice({ tone: "error", text: json?.error || "Could not delete the quotation." });
            return;
          }
          router.push("/quotes");
        }}
        title="Delete this quotation?"
        description="The document is removed. A quotation that has become a job cannot be deleted."
        confirmText="Delete"
        variant="destructive"
      />
    </AdminLayout>
  );
}

function AcceptDialog({
  open,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (name: string) => void;
  busy: boolean;
}) {
  const [name, setName] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record customer acceptance</DialogTitle>
          <DialogDescription>Printed on the quotation as the acceptance record.</DialogDescription>
        </DialogHeader>
        <Field label="Accepted by" required hint="The name of the person who accepted.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" autoFocus />
        </Field>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(name.trim())} disabled={name.trim().length < 2} loading={busy}>
            Record acceptance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({
  open,
  onClose,
  onConfirm,
  busy,
  managers,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (payload: { scheduledDate: string; scheduledTimeSlot: string; assignedManagerId?: string }) => void;
  busy: boolean;
  managers: { id: string; name: string }[];
}) {
  const [date, setDate] = useState(toLocalDateOffset(1));
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("13:30");
  const [managerId, setManagerId] = useState("");
  const invalid = !date || !from || !to || from >= to;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert into a job</DialogTitle>
          <DialogDescription>
            The quoted services, figures and GST carry over exactly. The job gets its own Job ID and QR.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Service date" required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" required>
              <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To" required error={from >= to ? "End must be after start." : null}>
              <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field label="Field Manager" hint="Optional — you can assign later from the job.">
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-sm text-zinc-900"
            >
              <option value="">Assign later</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="success"
            loading={busy}
            disabled={invalid}
            onClick={() =>
              onConfirm({
                scheduledDate: date,
                scheduledTimeSlot: `${from} - ${to}`,
                assignedManagerId: managerId || undefined,
              })
            }
          >
            Create job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
