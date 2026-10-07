"use client";

import React from "react";
import { useParams } from "next/navigation";
import { PortalLayout } from "@/components/common/PortalLayout";
import { useCustomerPortal } from "@/lib/use-customer-portal";
import { formatCurrency, formatDate, formatTimeSlot, cn } from "@/lib/utils";
import { CUSTOMER_JOURNEY } from "@/lib/rbac";
import { ChevronRight } from "lucide-react";

/**
 * One service in the customer portal. The live journey (confirm, progress,
 * before/after, approve, feedback) lives on the service's ONE secure link —
 * this page is the portal's doorway to it plus the invoice for the service.
 */
export default function MyServicePage() {
  const params = useParams();
  const id = String(params?.id ?? "");
  const { data, error, loading } = useCustomerPortal();
  const s = data?.services.find((x) => x.id === id);
  const invoice = data?.invoices.find((i) => i.jobId === id);

  return (
    <PortalLayout title={s?.serviceName ?? "Your Service"} backHref="/my-services">
      {error && <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}
      {loading && !data && <div className="text-center text-sm text-slate-400 py-10">Loading…</div>}
      {data && !s && <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center text-sm text-slate-500">We could not find this service.</div>}
      {s && (
        <>
          <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-4">
            <div>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</div>
              <div className="text-2xl font-semibold text-slate-900">{s.stage}</div>
              <div className="text-sm text-slate-500 mt-1">{formatDate(s.scheduledDate)} · {formatTimeSlot(s.scheduledTimeSlot)}</div>
              <div className="text-sm text-slate-500">{s.property.title}, {s.property.address}</div>
            </div>
            {!s.isCancelled && (
              <ol className="space-y-2">
                {CUSTOMER_JOURNEY.map((step, i) => (
                  <li key={step} className="flex items-center gap-3 text-sm">
                    <span className={cn("h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold", i < s.journeyIndex ? "bg-emerald-500 text-white" : i === s.journeyIndex ? "bg-rose-500 text-white" : "bg-slate-100 text-slate-400")}>{i < s.journeyIndex ? "✓" : i + 1}</span>
                    <span className={i === s.journeyIndex ? "font-semibold text-slate-900" : "text-slate-500"}>{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {s.link && (
              <a href={s.link} className="h-14 w-full rounded-xl bg-rose-500 text-white text-base font-semibold inline-flex items-center justify-center gap-2 hover:bg-rose-600">
                {s.nextAction?.label ?? "View Service"} <ChevronRight className="h-5 w-5" />
              </a>
            )}
            {s.nextAction?.hint && <p className="text-xs text-slate-500 text-center">{s.nextAction.hint}</p>}
          </section>

          {invoice && (
            <section className="rounded-2xl bg-white border border-slate-200 p-5 space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Invoice</div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{invoice.invoiceNumber}</span>
                <span className="font-semibold text-slate-900">{formatCurrency(invoice.total)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Paid</span>
                <span className="text-emerald-700">{formatCurrency(invoice.amountPaid)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Balance</span>
                <span className={invoice.balanceDue > 0 ? "text-amber-700 font-semibold" : "text-slate-500"}>{formatCurrency(invoice.balanceDue)}</span>
              </div>
              {!invoice.finalized && <p className="text-xs text-slate-400">Your final invoice will be sent after the service is completed and approved.</p>}
            </section>
          )}
        </>
      )}
    </PortalLayout>
  );
}
