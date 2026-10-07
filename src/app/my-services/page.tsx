"use client";

import React from "react";
import Link from "next/link";
import { PortalLayout } from "@/components/common/PortalLayout";
import { useCustomerPortal, type CustomerService } from "@/lib/use-customer-portal";
import { formatCurrency, formatDate, formatTimeSlot, cn } from "@/lib/utils";
import { CUSTOMER_JOURNEY } from "@/lib/rbac";
import { CheckCircle2, ChevronRight, Sparkles, ShieldCheck, Home, Receipt } from "lucide-react";

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(" ")[0]}`;
}

function ServiceCard({ s, emphasis }: { s: CustomerService; emphasis?: boolean }) {
  const cta = s.nextAction;
  const primary = cta && (cta.kind === "confirm" || cta.kind === "approve" || cta.kind === "feedback");
  return (
    <div className={cn("rounded-2xl bg-white border p-5 space-y-4 shadow-sm", emphasis ? "border-rose-200" : "border-slate-200")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">{s.serviceName}</div>
          <div className="text-sm text-slate-500">
            {s.isToday ? "Today" : formatDate(s.scheduledDate)} · {formatTimeSlot(s.scheduledTimeSlot).split(" - ")[0]}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{s.property.title}</div>
        </div>
        <span className={cn("px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap", s.isDone ? "bg-emerald-50 text-emerald-700" : s.isCancelled ? "bg-slate-100 text-slate-500" : primary ? "bg-rose-50 text-rose-700" : "bg-sky-50 text-sky-700")}>
          {s.stage}
        </span>
      </div>

      {!s.isCancelled && (
        <ol className="flex items-center gap-1">
          {CUSTOMER_JOURNEY.map((step, i) => (
            <li key={step} className="flex-1 flex flex-col items-center gap-1">
              <span className={cn("h-2.5 w-full rounded-full", i < s.journeyIndex ? "bg-emerald-500" : i === s.journeyIndex ? "bg-rose-500" : "bg-slate-200")} />
              <span className={cn("text-[9px] leading-tight text-center", i === s.journeyIndex ? "text-slate-900 font-semibold" : "text-slate-400")}>{step}</span>
            </li>
          ))}
        </ol>
      )}

      {s.link ? (
        <a
          href={s.link}
          className={cn(
            "h-14 w-full rounded-xl text-base font-semibold inline-flex items-center justify-center gap-2",
            primary ? "bg-rose-500 text-white hover:bg-rose-600" : "bg-slate-900 text-white hover:bg-slate-800"
          )}
        >
          {cta?.label ?? "View Service"} <ChevronRight className="h-5 w-5" />
        </a>
      ) : (
        <Link href={`/my-services/${s.id}`} className="h-14 w-full rounded-xl bg-slate-900 text-white text-base font-semibold inline-flex items-center justify-center gap-2">
          View Service <ChevronRight className="h-5 w-5" />
        </Link>
      )}
      {cta?.hint && <p className="text-xs text-slate-500 text-center">{cta.hint}</p>}
    </div>
  );
}

/**
 * CUSTOMER home — "My Services" (§13 / §22). A consumer app, not an ERP:
 * today's service with ONE big button, upcoming, recent, AMC (only when
 * the profile has it), invoices. Every service opens the ONE secure link.
 */
export default function MyServicesPage() {
  const { data, error, loading } = useCustomerPortal();
  const today = data?.services.filter((s) => s.isToday && !s.isDone && !s.isCancelled) ?? [];
  const upcoming = data?.services.filter((s) => s.isUpcoming) ?? [];
  const active = data?.services.filter((s) => !s.isToday && !s.isUpcoming && !s.isDone && !s.isCancelled) ?? [];
  const recent = data?.services.filter((s) => s.isDone).slice(0, 5) ?? [];
  const due = data?.invoices.filter((i) => i.balanceDue > 0 && i.finalized) ?? [];

  return (
    <PortalLayout title="My Services" greeting={data ? greeting(data.customer.name) : undefined}>
      {error && <div className="rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3">{error}</div>}
      {loading && !data && <div className="text-center text-sm text-slate-400 py-10">Loading your services…</div>}

      {data && (
        <>
          {(today.length > 0 || active.length > 0) && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">{today.length ? "Today" : "In progress"}</h2>
              {[...today, ...active].map((s) => <ServiceCard key={s.id} s={s} emphasis />)}
            </section>
          )}

          {due.length > 0 && (
            <section className="rounded-2xl bg-amber-50 border border-amber-200 p-5 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-amber-900">
                <Receipt className="h-5 w-5" /> {due.length === 1 ? "An invoice is ready" : `${due.length} invoices are ready`}
              </div>
              {due.map((i) => (
                <div key={i.id} className="flex items-center justify-between text-sm">
                  <span className="text-amber-900">{i.invoiceNumber} · due {formatDate(i.dueDate)}</span>
                  <span className="font-semibold text-amber-900">{formatCurrency(i.balanceDue)}</span>
                </div>
              ))}
              <p className="text-xs text-amber-800">Pay by UPI or bank transfer using the invoice number as reference. Our team confirms within a day.</p>
            </section>
          )}

          {upcoming.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">Upcoming</h2>
              {upcoming.map((s) => <ServiceCard key={s.id} s={s} />)}
            </section>
          )}

          {data.features.amc && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">Maintenance plan</h2>
              {data.amc.map((c) => (
                <div key={c.id} className="rounded-2xl bg-white border border-slate-200 p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-600" /> Annual maintenance</div>
                      <div className="text-sm text-slate-500">{c.propertyTitle} · {formatDate(c.startDate)} – {formatDate(c.endDate)}</div>
                    </div>
                    <span className={cn("px-3 py-1 rounded-full text-xs font-semibold", c.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{c.status === "ACTIVE" ? "Active" : c.status.replace("_", " ").toLowerCase()}</span>
                  </div>
                  {c.nri && (
                    <p className="text-xs text-slate-500 rounded-lg bg-slate-50 px-3 py-2">
                      Remote plan: you confirm the team&apos;s arrival and approve each visit from here. {c.localContactName ? `${c.localContactName} does not need to use the app.` : "Your local contact does not need to use the app."}
                    </p>
                  )}
                  {c.upcomingVisits.length > 0 ? (
                    <div className="text-sm">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Next visit</div>
                      <div className="font-medium text-slate-900">Visit {c.upcomingVisits[0].visitNumber} · {formatDate(c.upcomingVisits[0].scheduledDate)}</div>
                      {c.upcomingVisits.length > 1 && <div className="text-xs text-slate-500">{c.upcomingVisits.length - 1} more scheduled</div>}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No visits scheduled right now.</div>
                  )}
                  {c.visitHistory.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Visit history</div>
                      <ul className="divide-y divide-slate-100">
                        {c.visitHistory.slice(-4).reverse().map((v) => {
                          const svc = data.services.find((s) => s.id === v.jobId);
                          return (
                            <li key={v.id} className="py-2 text-sm flex items-center justify-between gap-2">
                              <div>
                                <div className="text-slate-900">Visit {v.visitNumber} · {formatDate(v.scheduledDate)}</div>
                                {v.recommendations && <div className="text-xs text-slate-500">Recommended: {v.recommendations}</div>}
                              </div>
                              {svc?.link ? (
                                <a href={svc.link} className="text-xs font-semibold text-rose-600">Report</a>
                              ) : v.qcScore != null ? (
                                <span className="text-xs text-emerald-700 font-semibold">Quality {v.qcScore}%</span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  <div className="text-xs text-slate-500">Plan value {formatCurrency(c.contractValue)} · {c.paymentStatus === "PAID" ? "Paid" : c.paymentStatus === "PARTIAL" ? "Partly paid" : "Payment pending"}</div>
                </div>
              ))}
            </section>
          )}

          {recent.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">Recent</h2>
              <ul className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
                {recent.map((s) => (
                  <li key={s.id}>
                    <a href={s.link ?? `/my-services/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{s.serviceName}</div>
                          <div className="text-xs text-slate-500">{formatDate(s.scheduledDate)}{s.rating ? ` · ${"★".repeat(s.rating)}` : ""}</div>
                        </div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.services.length === 0 && (
            <div className="rounded-2xl bg-white border border-slate-200 p-8 text-center space-y-2">
              <Sparkles className="h-8 w-8 text-rose-400 mx-auto" />
              <div className="text-base font-semibold text-slate-900">No services yet</div>
              <p className="text-sm text-slate-500">Your bookings will appear here with live progress and before/after photos.</p>
            </div>
          )}

          <section className="rounded-2xl bg-white border border-slate-200 p-5">
            <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm mb-2"><Home className="h-4 w-4 text-slate-400" /> Your properties</div>
            <ul className="text-sm text-slate-700 space-y-1">
              {data.properties.map((p) => (
                <li key={p.id}>{p.title} <span className="text-slate-400">· {p.address}</span></li>
              ))}
              {data.properties.length === 0 && <li className="text-slate-400">No properties on file.</li>}
            </ul>
          </section>
        </>
      )}
    </PortalLayout>
  );
}
