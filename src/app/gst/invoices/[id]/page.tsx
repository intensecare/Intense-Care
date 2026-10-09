"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Printer } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { Button } from "@/components/ui/button";
import { Skeleton, ErrorState } from "@/components/ui/states";
import { InvoiceDocument, useInvoiceDetail } from "@/components/invoice/InvoiceDocument";

/** One GST invoice, read-only, ready to print / save as PDF. */
export default function GstInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useInvoiceDetail(id);

  return (
    <AdminLayout>
      <div className="print:hidden flex flex-wrap items-center justify-between gap-3 mb-6">
        <Link href="/gst/invoices" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10">
          <ChevronLeft className="h-4 w-4" aria-hidden /> GST Invoices
        </Link>
        {data && (
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden /> Print / Save PDF
          </Button>
        )}
      </div>
      {error ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <Skeleton className="h-96" />
      ) : data ? (
        <InvoiceDocument detail={data} showPayments={false} />
      ) : null}
    </AdminLayout>
  );
}
