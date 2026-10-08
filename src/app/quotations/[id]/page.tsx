"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Printer, Download, Pencil, Copy, Briefcase, Receipt, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Skeleton, ErrorState, Notice } from "@/components/ui/states";
import { ShareButtons } from "@/components/document/DocParts";
import { QuotationDocument, type QuoteDetail } from "@/components/quote/QuotationDocument";
import { ConvertDialog, quoteApi } from "@/components/quote/QuoteParts";
import { formatMoney } from "@/lib/utils";
import type { Quote } from "@/lib/types";

type Detail = QuoteDetail & { job: { id: string; jobNumber: string; invoiceId: string | null } | null; shareUrl: string | null };

/** Admin → one quotation: print / PDF, share, edit, duplicate, accept, convert. */
export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [convert, setConvert] = useState<"convert-job" | "convert-invoice" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await quoteApi<Detail>(`/api/quotations/${encodeURIComponent(id)}`);
    if (r.error) setError(r.error);
    else setData(r.data!);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: string) => {
    setBusy(action);
    setNotice(null);
    const r = await quoteApi<Quote & { url?: string }>(`/api/quotations/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) });
    setBusy(null);
    if (r.error) {
      setNotice({ tone: "error", text: r.error });
      return null;
    }
    return r.data!;
  };

  if (error) return <AdminLayout><ErrorState message={error} onRetry={() => void load()} /></AdminLayout>;
  if (!data) return <AdminLayout><div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-96" /></div></AdminLayout>;

  const q = data.quote;
  const converted = q.status === "converted_to_job";
  const canAnswer = q.status === "sent" || q.status === "draft" || q.status === "expired";

  return (
    <AdminLayout>
      <div className="print:hidden space-y-4 mb-6">
        <Link href="/quotations" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Quotations
        </Link>
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 font-mono break-all">{q.quoteNumber}</h1>
            <p className="mt-1 text-sm text-zinc-600">{data.customer.name} · {formatMoney(q.total)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()} title="Choose “Save as PDF” in the print window"><Download className="h-4 w-4" aria-hidden /> Download PDF</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Print</Button>
            <ShareButtons
              phone={data.customer.phone}
              getUrl={async () => {
                if (data.shareUrl) return data.shareUrl;
                const r = await act("share");
                if (r?.url) await load();
                return r?.url ?? null;
              }}
              message={(url) => `Hello ${data.customer.name}, here is your quotation ${q.quoteNumber} from ${data.company.name || "Intense Care"} for ${formatMoney(q.total)}. View and accept it here: ${url}`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {!converted && (
              <Link href={`/quotations/${q.id}/edit`} className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
                <Pencil className="h-4 w-4" aria-hidden /> Edit
              </Link>
            )}
            <Button
              variant="outline"
              loading={busy === "duplicate"}
              onClick={async () => {
                const r = await act("duplicate");
                if (r) router.push(`/quotations/${r.id}`);
              }}
            >
              <Copy className="h-4 w-4" aria-hidden /> Duplicate
            </Button>
            {!converted && q.status !== "declined" && <Button onClick={() => setConvert("convert-job")}><Briefcase className="h-4 w-4" aria-hidden /> Convert to Job</Button>}
            {q.status !== "declined" && (!converted || data.job?.invoiceId) && (
              <Button variant="outline" onClick={() => setConvert("convert-invoice")}><Receipt className="h-4 w-4" aria-hidden /> Convert to Invoice</Button>
            )}
            {canAnswer && (
              <>
                <Button
                  variant="outline"
                  loading={busy === "accept"}
                  onClick={async () => {
                    if (await act("accept")) {
                      setNotice({ tone: "success", text: "Marked as accepted." });
                      await load();
                    }
                  }}
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> Mark accepted
                </Button>
                <Button
                  variant="ghost"
                  loading={busy === "decline"}
                  onClick={async () => {
                    if (await act("decline")) {
                      setNotice({ tone: "success", text: "Marked as declined." });
                      await load();
                    }
                  }}
                >
                  <XCircle className="h-4 w-4 text-red-600" aria-hidden /> Declined
                </Button>
              </>
            )}
            {!q.jobId && (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4 text-red-600" aria-hidden /> Delete</Button>
            )}
          </div>
        </div>
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {data.job && (
          <Notice tone="info">
            Converted to job{" "}
            <Link href={`/jobs/${data.job.id}`} className="font-mono font-semibold underline break-all">{data.job.jobNumber}</Link>
            {data.job.invoiceId && (
              <>
                {" "}· <Link href={`/invoices/${data.job.invoiceId}`} className="font-semibold underline">View invoice</Link>
              </>
            )}
          </Notice>
        )}
        {q.status === "expired" && <Notice tone="error">This quotation is past its valid-until date. Duplicate it to send a fresh one.</Notice>}
      </div>

      <QuotationDocument detail={data} />

      {convert && (
        <ConvertDialog
          quote={q}
          mode={convert}
          open
          onClose={() => setConvert(null)}
          onDone={(r) => {
            setConvert(null);
            if (convert === "convert-invoice" && r.invoiceId) router.push(`/invoices/${r.invoiceId}`);
            else router.push(`/jobs/${r.jobId}`);
          }}
        />
      )}
      <ConfirmModal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          const r = await quoteApi(`/api/quotations/${encodeURIComponent(q.id)}`, { method: "DELETE" });
          setConfirmDelete(false);
          if (r.error) setNotice({ tone: "error", text: r.error });
          else router.push("/quotations");
        }}
        title="Delete this quotation?"
        description="The quotation and its share link are removed. This can't be undone."
        confirmText="Delete"
      />
    </AdminLayout>
  );
}
