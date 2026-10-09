"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Printer, CreditCard, Lock, Download, Trash2, Ban } from "lucide-react";
import { ShareButtons } from "@/components/document/DocParts";
import { AdminLayout } from "@/components/common/AdminLayout";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Skeleton, ErrorState, Notice } from "@/components/ui/states";
import { InvoiceDocument, InvoiceTypeBadge, useInvoiceDetail } from "@/components/invoice/InvoiceDocument";
import { RecordPaymentDialog } from "@/components/invoice/RecordPaymentDialog";
import { useCustomerLink } from "@/components/common/JobQr";
import { useApp } from "@/lib/app-context";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";
import { computeInvoiceFigures, isValidGstin } from "@/lib/tax";

/** Admin → one invoice: print it, record a payment, finalize, switch GST / Non-GST, void or delete. */
export default function InvoiceDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useInvoiceDetail(id);
  const { payments, updateInvoice, finalizeInvoice, systemSettings } = useApp();
  const { linkUrl } = useCustomerLink(data?.job.id, !!data?.job.id);
  const [paying, setPaying] = useState(false);
  const [confirmFinal, setConfirmFinal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [type, setType] = useState<"GST" | "NON_GST">("GST");
  const [interState, setInterState] = useState(false);
  const [gstin, setGstin] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!data) return;
    setType(data.invoice.invoiceType);
    setInterState(data.invoice.interState);
    setGstin(data.invoice.customerGstin ?? data.customer.gstin ?? "");
  }, [data]);

  if (error) return <AdminLayout><ErrorState message={error} onRetry={() => void reload()} /></AdminLayout>;
  if (loading && !data) return <AdminLayout><div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96" /></div></AdminLayout>;
  if (!data) return null;

  const inv = data.invoice;
  const locked = Boolean(inv.finalizedAt);
  const isCancelled = inv.status === "CANCELLED";
  const invPayments = payments.filter((p) => p.invoiceId === inv.id);
  const dirty = type !== inv.invoiceType || (type === "GST" && (interState !== inv.interState || gstin.trim().toUpperCase() !== (inv.customerGstin ?? "")));
  const gstinError = type === "GST" && gstin.trim() && !isValidGstin(gstin) ? "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5." : null;
  const preview = computeInvoiceFigures({
    invoiceType: type,
    subtotal: inv.subtotal,
    discount: inv.discount,
    gstRatePercent: inv.invoiceType === "GST" && inv.gstRate > 0 ? inv.gstRate : systemSettings.taxRatePercent,
    interState,
  });

  const saveType = async () => {
    if (gstinError) return;
    setSaving(true);
    setNotice(null);
    const r = await updateInvoice(inv.id, { invoiceType: type, interState: type === "GST" ? interState : false, customerGstin: type === "GST" ? gstin.trim().toUpperCase() : "" });
    setSaving(false);
    setNotice({ tone: r.success ? "success" : "error", text: r.success ? `Saved as a ${type === "GST" ? "GST" : "Non-GST"} invoice.` : r.message });
    if (r.success) await reload();
  };

  const handleVoidInvoice = async () => {
    setActionLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED", reason: "Cancelled by administrator." }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to cancel invoice.");
      setConfirmVoid(false);
      setNotice({ tone: "success", text: "Invoice marked as CANCELLED." });
      await reload();
    } catch (err: any) {
      setNotice({ tone: "error", text: err.message || "Error cancelling invoice." });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteInvoice = async () => {
    setActionLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to delete invoice.");
      setConfirmDelete(false);
      router.push("/invoices");
    } catch (err: any) {
      setNotice({ tone: "error", text: err.message || "Error deleting invoice." });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <AdminLayout>
      <div className="print:hidden space-y-4 mb-6">
        <Link href="/invoices" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Invoices
        </Link>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 font-mono break-all">{inv.invoiceNumber}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
              <InvoiceTypeBadge type={inv.invoiceType} />
              {isCancelled ? (
                <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-xs font-semibold">Cancelled</span>
              ) : locked ? (
                <span className="inline-flex items-center gap-1"><Lock className="h-4 w-4" aria-hidden /> Finalized</span>
              ) : (
                <span>Draft — can still be changed</span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()} title="Choose “Save as PDF” in the print window"><Download className="h-4 w-4" aria-hidden /> Download PDF</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
            {linkUrl && (
              <ShareButtons
                getUrl={async () => linkUrl}
                phone={data.customer.phone}
                message={(url) => `Hello ${data.customer.name}, your invoice ${inv.invoiceNumber} for ${formatMoney(inv.total)} from ${data.company.name || "Intense Care"}: ${url}`}
              />
            )}
            {!isCancelled && inv.balanceDue > 0 && <Button onClick={() => setPaying(true)}><CreditCard className="h-4 w-4" aria-hidden /> Record payment</Button>}
            {!isCancelled && (
              <Button variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-50" onClick={() => setConfirmVoid(true)}>
                <Ban className="h-4 w-4" aria-hidden /> Cancel invoice
              </Button>
            )}
            {invPayments.length === 0 && (
              <Button variant="outline" className="text-rose-700 border-rose-300 hover:bg-rose-50" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden /> Delete
              </Button>
            )}
          </div>
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        {!locked && !isCancelled && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-zinc-950">Invoice type</h2>
              <p className="text-sm text-zinc-500">Choose before finalizing. A Non-GST invoice carries no GST at all.</p>
            </div>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Invoice type">
              {(["GST", "NON_GST"] as const).map((t) => (
                <button key={t} role="radio" aria-checked={type === t} onClick={() => setType(t)} className={cn("min-h-12 rounded-xl border-2 px-3 text-base font-semibold", type === t ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 bg-white text-zinc-700")}>
                  {t === "GST" ? "GST Invoice" : "Non-GST Invoice"}
                </button>
              ))}
            </div>
            {type === "GST" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Customer GSTIN" htmlFor="inv-gstin" hint="Leave empty for an unregistered customer" error={gstinError}>
                  <Input id="inv-gstin" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" maxLength={15} autoCapitalize="characters" />
                </Field>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium text-zinc-800">Place of supply</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {[false, true].map((v) => (
                      <button key={String(v)} type="button" aria-pressed={interState === v} onClick={() => setInterState(v)} className={cn("min-h-11 rounded-xl border px-3 text-sm font-medium", interState === v ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}>
                        {v ? "Other state (IGST)" : "Same state (CGST+SGST)"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3 text-sm">
              <span className="text-zinc-600">
                {preview.invoiceType === "GST" ? `GST ${preview.gstRate}% = ${formatMoney(preview.tax)}` : "No GST"}
              </span>
              <span className="font-semibold text-zinc-950">Grand total {formatMoney(preview.total)}</span>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmFinal(true)} disabled={dirty}>Finalize invoice</Button>
              <Button onClick={() => void saveType()} disabled={!dirty || !!gstinError} loading={saving}>{saving ? "Saving…" : "Save"}</Button>
            </div>
          </section>
        )}
      </div>

      <InvoiceDocument detail={data} qrUrl={linkUrl} />

      {invPayments.length > 0 && (
        <section className="print:hidden mt-6 rounded-2xl border border-zinc-200 bg-white p-5">
          <h2 className="text-base font-semibold text-zinc-950 mb-3">Payments</h2>
          <ul className="divide-y divide-zinc-100">
            {invPayments.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0"><span className="font-semibold text-emerald-700">{formatMoney(p.amount)}</span> <span className="text-zinc-500 break-all">· {p.transactionReference}</span></span>
                <span className="text-zinc-500 shrink-0">{formatDateTime(p.paidAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecordPaymentDialog invoice={paying ? inv : null} onClose={() => setPaying(false)} onDone={() => void reload()} />
      <ConfirmModal
        isOpen={confirmFinal}
        onClose={() => setConfirmFinal(false)}
        onConfirm={async () => {
          const r = await finalizeInvoice(inv.id);
          setConfirmFinal(false);
          setNotice({ tone: r.success ? "success" : "error", text: r.success ? "Invoice finalized." : r.message });
          await reload();
        }}
        title="Finalize this invoice?"
        description="After finalizing, the type and amounts can no longer be changed."
        confirmText="Finalize"
        variant="default"
      />
      <ConfirmModal
        isOpen={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        onConfirm={handleVoidInvoice}
        title="Cancel this invoice?"
        description="This marks the invoice as Cancelled and sets its balance to zero. Financial history is preserved."
        confirmText="Cancel Invoice"
        variant="destructive"
      />
      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDeleteInvoice}
        title="Delete this invoice?"
        description="This will permanently delete this invoice record. This action cannot be undone."
        confirmText="Delete permanently"
        variant="destructive"
      />
    </AdminLayout>
  );
}
