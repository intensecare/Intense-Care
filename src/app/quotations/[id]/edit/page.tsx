"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { QuoteEditor } from "@/components/quote/QuoteEditor";
import { quoteApi } from "@/components/quote/QuoteParts";
import { Skeleton, ErrorState, Notice } from "@/components/ui/states";
import type { Quote } from "@/lib/types";

/** Admin → Edit a quotation (not once it became a job). */
export default function EditQuotationPage() {
  const { id } = useParams<{ id: string }>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void quoteApi<{ quote: Quote }>(`/api/quotations/${encodeURIComponent(id)}`).then((r) => (r.error ? setError(r.error) : setQuote(r.data!.quote)));
  }, [id]);

  return (
    <AdminLayout>
      <Link href={`/quotations/${id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Back to quotation
      </Link>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 mt-2 mb-5">Edit {quote?.quoteNumber ?? "quotation"}</h1>
      {error ? (
        <ErrorState message={error} />
      ) : !quote ? (
        <Skeleton className="h-96" />
      ) : quote.status === "converted_to_job" ? (
        <Notice tone="info">This quotation is already a job. Edit the job&apos;s invoice instead.</Notice>
      ) : (
        <>
          {quote.status === "accepted" && <Notice tone="info" className="mb-4">Saving changes sends the quotation back to the customer for acceptance.</Notice>}
          <QuoteEditor initial={quote} />
        </>
      )}
    </AdminLayout>
  );
}
