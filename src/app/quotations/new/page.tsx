"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { QuoteEditor } from "@/components/quote/QuoteEditor";

function NewQuotation() {
  const params = useSearchParams();
  return <QuoteEditor presetCustomerId={params.get("customerId") ?? undefined} />;
}

/** Admin → New Quotation. */
export default function NewQuotationPage() {
  return (
    <AdminLayout>
      <Link href="/quotations" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Quotations
      </Link>
      <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 mt-2 mb-5">New Quotation</h1>
      <Suspense>
        <NewQuotation />
      </Suspense>
    </AdminLayout>
  );
}
