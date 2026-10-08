"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge, PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { CustomerFormDialog, type CustomerFormPayload } from "@/components/common/CustomerFormDialog";
import { PropertyFormDialog } from "@/components/common/PropertyFormDialog";
import { CustomerStatementModal } from "@/components/common/CustomerStatementModal";
import { DataTable } from "@/components/ui/data-table";
import { ErrorState, Notice, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency, formatDate, formatTimeSlot } from "@/lib/utils";
import type { CustomerDetailSnapshot, Property } from "@/lib/types";
import { Building2, Briefcase, Edit2, Mail, MapPin, Phone, Plus, Trash2, AlertTriangle, FileText } from "lucide-react";

/** One customer: contact, properties, jobs, payments, issues — no tabs. */
export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = (params?.id as string) || "";
  const { partners, systemSettings, updateCustomer, deleteCustomer, createProperty, updateProperty, deleteProperty, customers } = useApp();
  const { can } = useAuth();

  const [snapshot, setSnapshot] = useState<CustomerDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [propertyDialog, setPropertyDialog] = useState<{ open: boolean; editing: Property | null }>({ open: false, editing: null });
  const [deleteProp, setDeleteProp] = useState<Property | null>(null);
  const [statementOpen, setStatementOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setPageError(res.status === 404 ? "This customer doesn't exist any more." : "Something went wrong while loading this customer.");
        setSnapshot(null);
      } else {
        setSnapshot(json.data as CustomerDetailSnapshot);
        setPageError("");
      }
    } catch {
      setPageError("You're offline. Check your connection and try again.");
    }
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    if (customerId) void load();
  }, [customerId, load]);

  if (loading && !snapshot) {
    return (
      <AdminLayout>
        <div className="space-y-4" role="status" aria-label="Loading customer">
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </AdminLayout>
    );
  }

  if (pageError || !snapshot) {
    return (
      <AdminLayout>
        <PageHeader title="Customer" breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: "Customer" }]} />
        <ErrorState message={pageError || "Customer not found."} onRetry={() => void load()} />
      </AdminLayout>
    );
  }

  const { customer, properties, jobs, stats } = snapshot;
  const invoices = snapshot.invoices ?? [];
  const complaints = (snapshot.complaints ?? []).filter((c) => c.status !== "resolved" && c.status !== "closed");
  const showMoney = can("finance.view");

  return (
    <AdminLayout>
      <PageHeader
        title={customer.name}
        description={`${stats.totalBookings} job${stats.totalBookings === 1 ? "" : "s"} · ${stats.activeJobs} active · ${stats.completedJobs} completed`}
        breadcrumbs={[{ label: "Customers", href: "/customers" }, { label: customer.name }]}
        actions={
          <>
            {can("jobs.create") && (
              <Link href="/jobs/new" className="inline-flex h-11 items-center gap-2 rounded-xl bg-rose-500 px-4 text-sm font-semibold text-white hover:bg-rose-600">
                <Plus className="h-5 w-5" aria-hidden /> New Job
              </Link>
            )}
            {showMoney && <Button variant="outline" onClick={() => setStatementOpen(true)}><FileText className="h-4 w-4" aria-hidden /> Statement</Button>}
            {can("customers.update") && <Button variant="outline" onClick={() => setEditOpen(true)}><Edit2 className="h-4 w-4" aria-hidden /> Edit</Button>}
          </>
        }
      />

      {actionError && <Notice tone="error" className="mb-4">{actionError}</Notice>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6">
          {/* Contact */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
            <h2 className="text-base font-semibold text-zinc-950">Contact</h2>
            <Info icon={<Phone className="h-4 w-4" aria-hidden />} label="Phone" value={<a href={`tel:${customer.phone}`} className="text-rose-600 font-medium">{customer.phone}</a>} />
            {customer.email && <Info icon={<Mail className="h-4 w-4" aria-hidden />} label="Email" value={<a href={`mailto:${customer.email}`} className="text-rose-600 font-medium break-all">{customer.email}</a>} />}
            {customer.address && <Info icon={<MapPin className="h-4 w-4" aria-hidden />} label="Address" value={customer.address} />}
            {customer.notes && <p className="rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{customer.notes}</p>}
            {showMoney && stats.outstanding !== undefined && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-xl bg-zinc-50 p-3"><div className="text-xs text-zinc-500">Paid</div><div className="text-base font-semibold text-emerald-700">{formatCurrency(stats.collected ?? 0)}</div></div>
                <div className="rounded-xl bg-zinc-50 p-3"><div className="text-xs text-zinc-500">Due</div><div className="text-base font-semibold text-amber-700">{formatCurrency(stats.outstanding ?? 0)}</div></div>
              </div>
            )}
          </section>

          {/* Open issues */}
          {complaints.length > 0 && (
            <section className="rounded-2xl border border-red-200 bg-white p-5 space-y-3">
              <h2 className="text-base font-semibold text-red-800 flex items-center gap-2"><AlertTriangle className="h-5 w-5" aria-hidden /> Open customer issues</h2>
              {complaints.map((c) => (
                <Link key={c.id} href={`/jobs/${c.jobId}`} className="block rounded-xl bg-red-50 p-3 text-sm text-red-900">
                  {c.description}
                  <span className="block text-xs text-red-700 mt-1">{formatDate(c.createdAt)} · open job</span>
                </Link>
              ))}
            </section>
          )}

          {/* Properties */}
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-zinc-950">Properties</h2>
              {can("properties.create") && <Button variant="outline" size="sm" onClick={() => setPropertyDialog({ open: true, editing: null })}><Plus className="h-4 w-4" aria-hidden /> Add</Button>}
            </div>
            {properties.length === 0 ? (
              <p className="text-sm text-zinc-500">No properties yet.</p>
            ) : (
              <ul className="space-y-2">
                {properties.map((p) => (
                  <li key={p.id} className="rounded-xl border border-zinc-200 p-3">
                    <div className="flex items-start gap-3">
                      <Building2 className="h-5 w-5 text-zinc-400 shrink-0 mt-0.5" aria-hidden />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-zinc-950">{p.title}</div>
                        <div className="text-sm text-zinc-500 break-words">{p.address}</div>
                      </div>
                    </div>
                    {(can("properties.update") || can("properties.delete")) && (
                      <div className="mt-2 flex gap-2">
                        {can("properties.update") && <Button variant="ghost" size="sm" onClick={() => setPropertyDialog({ open: true, editing: p })}><Edit2 className="h-4 w-4" aria-hidden /> Edit</Button>}
                        {can("properties.delete") && <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setDeleteProp(p)}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {can("customers.delete") && (
            <button onClick={() => setDeleteOpen(true)} className="text-sm font-semibold text-red-700 inline-flex items-center gap-1.5">
              <Trash2 className="h-4 w-4" aria-hidden /> Delete customer
            </button>
          )}
        </div>

        <div className="xl:col-span-2 space-y-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-950">Jobs</h2>
            {jobs.length === 0 ? (
              <EmptyState icon={Briefcase} title="No jobs yet" description="Book the first job for this customer." actionLabel={can("jobs.create") ? "New job" : undefined} onAction={() => router.push("/jobs/new")} />
            ) : (
              <DataTable
                caption="Jobs"
                rows={[...jobs].sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate))}
                rowKey={(j) => j.id}
                href={(j) => `/jobs/${j.id}`}
                columns={[
                  { key: "job", header: "Job", mobile: "title", cell: (j) => <span className="font-semibold">{j.service?.name ?? "Service"}</span> },
                  { key: "num", header: "Job ID", mobile: "subtitle", cell: (j) => j.jobNumber ?? j.id.slice(-6) },
                  { key: "status", header: "Status", mobile: "badge", cell: (j) => <StatusBadge status={j.status} size="sm" /> },
                  { key: "date", header: "Date", cell: (j) => `${formatDate(j.scheduledDate)} · ${formatTimeSlot(j.scheduledTimeSlot).split(" - ")[0]}` },
                  { key: "prop", header: "Property", cell: (j) => (j.propertyTitle ?? "").split(" - ")[0] },
                ]}
              />
            )}
          </section>

          {showMoney && invoices.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-zinc-950">Invoices</h2>
              <DataTable
                caption="Invoices"
                rows={invoices}
                rowKey={(i) => i.id}
                columns={[
                  { key: "no", header: "Invoice", mobile: "title", cell: (i) => <span className="font-semibold">{i.invoiceNumber}</span> },
                  { key: "date", header: "Issued", mobile: "subtitle", cell: (i) => formatDate(i.issuedAt) },
                  { key: "status", header: "Status", mobile: "badge", cell: (i) => <PaymentStatusBadge status={i.status} /> },
                  { key: "total", header: "Total", align: "right", cell: (i) => formatCurrency(i.total) },
                  { key: "due", header: "Due", align: "right", cell: (i) => (i.balanceDue > 0 ? <span className="font-semibold text-amber-700">{formatCurrency(i.balanceDue)}</span> : "—") },
                ]}
              />
              <Link href="/invoices" className="text-sm font-semibold text-rose-600">Record a payment on the Invoices page →</Link>
            </section>
          )}
        </div>
      </div>

      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        partners={partners}
        editing={customer}
        onSubmit={async (payload: CustomerFormPayload) => {
          const r = await updateCustomer(customerId, { ...payload });
          if (r.success) await load();
          return r;
        }}
      />
      <PropertyFormDialog
        open={propertyDialog.open}
        onOpenChange={(open) => setPropertyDialog((d) => ({ ...d, open }))}
        customers={customers}
        editing={propertyDialog.editing}
        defaultCustomerId={customerId}
        onSubmit={async (payload) => {
          const r = propertyDialog.editing ? await updateProperty(propertyDialog.editing.id, payload) : await createProperty(payload);
          if (r.success) {
            setPropertyDialog({ open: false, editing: null });
            await load();
          }
          return r;
        }}
      />
      {showMoney && (
        <CustomerStatementModal isOpen={statementOpen} onClose={() => setStatementOpen(false)} customer={customer} invoices={invoices} payments={snapshot.payments ?? []} jobs={jobs} systemSettings={systemSettings} />
      )}
      <ConfirmModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete customer?"
        description={`${customer.name} will be removed. Customers with jobs can't be deleted.`}
        confirmText="Delete"
        onConfirm={async () => {
          const r = await deleteCustomer(customerId);
          if (!r.success) setActionError(r.message);
          else router.push("/customers");
        }}
      />
      <ConfirmModal
        isOpen={!!deleteProp}
        onClose={() => setDeleteProp(null)}
        title="Delete property?"
        description={`${deleteProp?.title ?? "This property"} will be removed. Properties with jobs can't be deleted.`}
        confirmText="Delete"
        onConfirm={async () => {
          if (!deleteProp) return;
          const r = await deleteProperty(deleteProp.id);
          if (!r.success) setActionError(r.message);
          else await load();
        }}
      />
    </AdminLayout>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="h-8 w-8 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">{label}</div>
        <div className="text-sm text-zinc-900 break-words">{value}</div>
      </div>
    </div>
  );
}
