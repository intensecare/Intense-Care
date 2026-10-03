"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { JobStatusBadge, PaymentStatusBadge } from "@/components/common/JobStatusBadge";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { CustomerFormDialog } from "@/components/common/CustomerFormDialog";
import { PropertyFormDialog } from "@/components/common/PropertyFormDialog";
import { useApp } from "@/lib/app-context";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import type { CustomerDetailSnapshot, Invoice, Property, Quote } from "@/lib/types";
import {
  Users,
  Phone,
  Mail,
  MapPin,
  Building2,
  Share2,
  Loader2,
  Edit2,
  Trash2,
  Plus,
  Wallet,
  Receipt,
  CalendarCheck,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  KeyRound,
  Car,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const customerId = (params?.id as string) || "";

  const {
    partners,
    currentRole,
    updateCustomer,
    deleteCustomer,
    createProperty,
    updateProperty,
    deleteProperty,
    recordPayment,
    convertQuoteToInvoice,
    deleteQuote,
  } = useApp();

  const canEdit = currentRole === "super_admin" || currentRole === "ops_manager";
  const canDelete = currentRole === "super_admin";
  const isSuper = currentRole === "super_admin";

  const [snapshot, setSnapshot] = useState<CustomerDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [actionError, setActionError] = useState("");

  // Customer edit / delete
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Property CRUD (dialog + delete confirm)
  const [propertyDialog, setPropertyDialog] = useState<{
    open: boolean;
    editing: Property | null;
  }>({ open: false, editing: null });
  const [deletePropertyTarget, setDeletePropertyTarget] = useState<Property | null>(null);

  // Payment collection
  const [payInvoice, setPayInvoice] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState<"upi" | "card" | "bank_transfer" | "cash">("upi");
  const [payRef, setPayRef] = useState("");
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Re-fetches the role-scoped 360° snapshot after any mutation. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        setPageError(json?.error || "Could not load the customer file.");
        setSnapshot(null);
      } else {
        setSnapshot(json.data as CustomerDetailSnapshot);
        setPageError("");
      }
    } catch {
      setPageError("Network error while loading the customer file.");
      setSnapshot(null);
    }
    setLoading(false);
  }, [customerId]);

  useEffect(() => {
    if (customerId) void load();
  }, [customerId, load]);

  if (loading && !snapshot) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center py-24 text-slate-400 text-xs gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading customer file...
        </div>
      </AdminLayout>
    );
  }

  if (pageError || !snapshot) {
    return (
      <AdminLayout>
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm font-semibold text-slate-800">{pageError || "Customer not found."}</p>
          <Link href="/customers">
            <Button variant="outline" size="sm" className="text-xs">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Back to Customers
            </Button>
          </Link>
        </div>
      </AdminLayout>
    );
  }

  const { customer, properties, jobs, partner, stats } = snapshot;
  const invoices = snapshot.invoices ?? [];
  const payments = snapshot.payments ?? [];
  const quotes = snapshot.quotes ?? [];
  const complaints = snapshot.complaints ?? [];

  const handleSaveCustomer = async (payload: {
    name: string;
    phone: string;
    email: string;
    whatsapp: string;
    address: string;
    source: string;
    referralPartnerId: string | null;
    notes: string;
    status: "active" | "inactive";
  }) => {
    const result = await updateCustomer(customerId, { ...payload });
    if (result.success) await load();
    return result;
  };

  const handleDeleteConfirm = async () => {
    setBusy(true);
    const result = await deleteCustomer(customerId);
    setBusy(false);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    router.push("/customers");
  };

  const handlePropertySubmit = async (
    payload: Parameters<typeof createProperty>[0]
  ): Promise<{ success: boolean; message: string }> => {
    const result = propertyDialog.editing
      ? await updateProperty(propertyDialog.editing.id, payload)
      : await createProperty(payload);
    if (result.success) {
      setPropertyDialog({ open: false, editing: null });
      await load();
    }
    return result;
  };

  const handleDeletePropertyConfirm = async () => {
    if (!deletePropertyTarget) return;
    const result = await deleteProperty(deletePropertyTarget.id);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    setDeletePropertyTarget(null);
    await load();
  };

  const openPayment = (inv: Invoice) => {
    setActionError("");
    setPayInvoice(inv);
    setPayAmount(inv.balanceDue);
    setPayRef(`TXN-${Date.now().toString().slice(-6)}`);
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payInvoice || payAmount <= 0) return;
    setIsSubmittingPayment(true);
    const result = await recordPayment(payInvoice.id, payAmount, payMethod, payRef);
    setIsSubmittingPayment(false);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    setPayInvoice(null);
    await load();
  };

  const handleConvertQuote = async (q: Quote) => {
    setActionError("");
    const result = await convertQuoteToInvoice(q.id);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    await load();
  };

  const handleDeleteQuote = async (q: Quote) => {
    setActionError("");
    const result = await deleteQuote(q.id);
    if (!result.success) {
      setActionError(result.message);
      return;
    }
    await load();
  };

  return (
    <AdminLayout>
      <PageHeader
        title={customer.name}
        description="Full customer file: profile, properties, booking history, collections, referral attribution and support issues."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Customers", href: "/customers" },
          { label: customer.name },
        ]}
        actions={
          <div className="flex items-center gap-1.5">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setActionError("");
                  setIsEditOpen(true);
                }}
              >
                <Edit2 className="h-3.5 w-3.5 mr-1" />
                Edit Profile
              </Button>
            )}
            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
                onClick={() => {
                  setActionError("");
                  setIsDeleteOpen(true);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Delete
              </Button>
            )}
          </div>
        }
      />

      {actionError && (
        <p className="mb-4 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">
          {actionError}
        </p>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {isSuper && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4 shadow-xs">
            <div className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
              Lifetime Revenue
            </div>
            <div className="text-2xl font-bold text-emerald-700 mt-2">
              {formatCurrency(stats.lifetimeRevenue ?? 0)}
            </div>
            <div className="text-xs text-emerald-600 mt-1">
              {formatCurrency(stats.collected ?? 0)} collected of {formatCurrency(stats.billedTotal ?? 0)} billed
            </div>
          </div>
        )}
        {isSuper && (
          <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-4 shadow-xs">
            <div className="text-xs font-semibold uppercase tracking-wider text-rose-800">
              Outstanding Balance
            </div>
            <div className="text-2xl font-bold text-rose-700 mt-2">
              {formatCurrency(stats.outstanding ?? 0)}
            </div>
            <div className="text-xs text-rose-600 mt-1">Awaiting collection</div>
          </div>
        )}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Total Bookings
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.totalBookings}</div>
          <div className="text-xs text-slate-400 mt-1">All-time service bookings</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Completed
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.completedJobs}</div>
          <div className="text-xs text-slate-400 mt-1">Delivered &amp; closed bookings</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active Pipeline
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.activeJobs}</div>
          <div className="text-xs text-slate-400 mt-1">Scheduled / in-progress jobs</div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="bg-slate-200/70 p-1">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties">Properties ({properties.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({jobs.length})</TabsTrigger>
          {isSuper && <TabsTrigger value="transactions">Transactions ({invoices.length})</TabsTrigger>}
          {isSuper && <TabsTrigger value="quotations">Quotations ({quotes.length})</TabsTrigger>}
        </TabsList>

        {/* 1. OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
              <h3 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100">
                Profile Details
              </h3>
              <div className="flex items-center gap-2 text-slate-700">
                <Phone className="h-3.5 w-3.5 text-slate-400" />
                <span className="font-mono">{customer.phone}</span>
                <span className="text-slate-400">· WhatsApp routed to this number</span>
              </div>
              {customer.email && (
                <div className="flex items-center gap-2 text-slate-700">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  {customer.email}
                </div>
              )}
              {customer.address && (
                <div className="flex items-start gap-2 text-slate-700">
                  <MapPin className="h-3.5 w-3.5 text-slate-400 mt-0.5" />
                  {customer.address}
                </div>
              )}
              <div className="flex items-center gap-4 pt-1 text-[11px] text-slate-500">
                <span>
                  Source:{" "}
                  <strong className="text-slate-700 capitalize">{customer.source}</strong>
                </span>
                <span>
                  Registered:{" "}
                  <strong className="text-slate-700">{formatDate(customer.createdAt)}</strong>
                </span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                    customer.status === "active"
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {customer.status}
                </span>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
              <h3 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100">
                Referral Attribution
              </h3>
              {partner ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono font-bold text-slate-900">
                      {partner.code}
                    </span>
                    <span className="font-semibold text-slate-800">{partner.name}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        partner.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {partner.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Bookings attributed to this partner settle their commission automatically on
                    completion (Referrals module).
                  </p>
                  {isSuper && (
                    <Link href="/referrals">
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        Open Referrals Ledger
                      </Button>
                    </Link>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">
                  Direct customer — no referral partner attribution. Assign one via{" "}
                  <strong>Edit Profile</strong> to track lead conversion and commissions.
                </p>
              )}
            </div>
          </div>

          {customer.notes && (
            <div className="text-xs text-slate-600 bg-white border border-slate-200 p-3 rounded-lg shadow-xs">
              <strong className="text-slate-800">Preferences / Notes:</strong> {customer.notes}
            </div>
          )}

          {/* Support issues */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Support Issues ({complaints.length})
            </h3>
            {complaints.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No complaints or attention requests on record.
              </p>
            ) : (
              <div className="space-y-2">
                {complaints.map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-200 text-slate-700">
                          {c.category.replace("_", " ")}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            c.severity === "critical"
                              ? "bg-rose-100 text-rose-800"
                              : c.severity === "high"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {c.severity}
                        </span>
                        <Link
                          href={`/jobs/${c.jobId}`}
                          className="font-mono text-[11px] text-blue-600 hover:underline"
                        >
                          {c.jobId}
                        </Link>
                      </div>
                      <p className="text-slate-700">{c.description}</p>
                      {c.resolutionNotes && (
                        <p className="text-[11px] text-emerald-700">
                          <strong>Resolution:</strong> {c.resolutionNotes}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          c.status === "open"
                            ? "bg-rose-100 text-rose-800"
                            : "bg-emerald-100 text-emerald-800"
                        }`}
                      >
                        {c.status.replace("_", " ")}
                      </span>
                      <div className="text-[10px] text-slate-400">{formatDate(c.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* 2. PROPERTIES */}
        <TabsContent value="properties" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Registered service locations with access instructions for field crews.
            </p>
            {canEdit && (
              <Button
                size="sm"
                className="h-8 text-xs bg-slate-900 text-white"
                onClick={() => {
                  setActionError("");
                  setPropertyDialog({ open: true, editing: null });
                }}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add Property
              </Button>
            )}
          </div>

          {properties.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No properties registered"
              description="Add the customer's residences or commercial facilities to store access notes and parking instructions for field workers."
              actionLabel={canEdit ? "Add Property" : undefined}
              onAction={canEdit ? () => setPropertyDialog({ open: true, editing: null }) : undefined}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {properties.map((p) => (
                <div
                  key={p.id}
                  className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-3 text-xs"
                >
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-blue-600 shrink-0" />
                      <span className="font-bold text-slate-900 text-sm">{p.title}</span>
                      <span className="capitalize px-2 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700">
                        {p.propertyType}
                      </span>
                    </div>
                    {(canEdit || canDelete) && (
                      <div className="flex items-center gap-1.5">
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              setActionError("");
                              setPropertyDialog({ open: true, editing: p });
                            }}
                            title="Edit property"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
                            onClick={() => {
                              setActionError("");
                              setDeletePropertyTarget(p);
                            }}
                            title="Delete property"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-start gap-1.5 text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                    <span>
                      {p.address}
                      {p.city ? ` (${p.city})` : ""}
                      {p.postalCode ? ` ${p.postalCode}` : ""}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center gap-3">
                    <span>{p.bedrooms ?? 3} Beds</span>
                    <span>•</span>
                    <span>{p.bathrooms ?? 2} Baths</span>
                    <span>•</span>
                    <span>{p.carpetAreaSqFt ?? 1000} sq ft</span>
                    {p.recurringService && (
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Recurring: {p.recurringFrequency || "monthly"}
                      </span>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 grid grid-cols-1 gap-2 text-[11px]">
                    {p.accessNotes && (
                      <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600">
                        <strong className="text-slate-800 flex items-center gap-1">
                          <KeyRound className="h-3 w-3 text-amber-500" />
                          Access:
                        </strong>
                        {p.accessNotes}
                      </div>
                    )}
                    {p.parkingInstructions && (
                      <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600">
                        <strong className="text-slate-800 flex items-center gap-1">
                          <Car className="h-3 w-3 text-blue-500" />
                          Parking:
                        </strong>
                        {p.parkingInstructions}
                      </div>
                    )}
                    {p.preferredTime && (
                      <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600 flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" />
                        <strong className="text-slate-800">Preferred time:</strong>
                        {p.preferredTime}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* 3. BOOKINGS */}
        <TabsContent value="bookings" className="space-y-4">
          {jobs.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="No bookings on record"
              description="Bookings created for this customer appear here with their lifecycle status."
            />
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="py-3 px-4">Scheduled</th>
                      <th className="py-3 px-4">Service</th>
                      <th className="py-3 px-4">Property</th>
                      <th className="py-3 px-4">Status</th>
                      {isSuper && <th className="py-3 px-4">Amount</th>}
                      {isSuper && <th className="py-3 px-4">Payment</th>}
                      <th className="py-3 px-4 text-right">Job File</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {jobs.map((j) => (
                      <tr key={j.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{formatDate(j.scheduledDate)}</div>
                          <div className="text-[11px] text-slate-400">{j.scheduledTimeSlot}</div>
                        </td>
                        <td className="py-3 px-4">{j.service?.name ?? j.serviceId}</td>
                        <td className="py-3 px-4 text-slate-600">
                          {j.propertyTitle ?? j.propertyId}
                        </td>
                        <td className="py-3 px-4">
                          <JobStatusBadge status={j.status} />
                        </td>
                        {isSuper && (
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {formatCurrency(j.amount ?? 0)}
                          </td>
                        )}
                        {isSuper && j.paymentStatus && (
                          <td className="py-3 px-4">
                            <PaymentStatusBadge status={j.paymentStatus} />
                          </td>
                        )}
                        <td className="py-3 px-4 text-right">
                          <Link href={`/jobs/${j.id}`}>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              Open
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* 4. TRANSACTIONS (super_admin) */}
        {isSuper && (
          <TabsContent value="transactions" className="space-y-4">
            {invoices.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No invoices issued"
                description="Tax invoices generated for this customer's bookings appear here."
              />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold text-[11px]">
                      <tr>
                        <th className="py-3 px-4">Invoice #</th>
                        <th className="py-3 px-4">Issued</th>
                        <th className="py-3 px-4">Total</th>
                        <th className="py-3 px-4">Paid / Balance</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-700">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {inv.invoiceNumber}
                          </td>
                          <td className="py-3 px-4 text-slate-500">{formatDate(inv.issuedAt)}</td>
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {formatCurrency(inv.total)}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-emerald-700 font-semibold">
                              {formatCurrency(inv.amountPaid)}
                            </span>{" "}
                            /
                            <span
                              className={
                                inv.balanceDue > 0 ? "text-rose-600 font-bold" : "text-slate-400"
                              }
                            >
                              {" "}
                              {formatCurrency(inv.balanceDue)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <PaymentStatusBadge status={inv.status} />
                          </td>
                          <td className="py-3 px-4 text-right">
                            {inv.balanceDue > 0 && (
                              <Button
                                size="sm"
                                onClick={() => openPayment(inv)}
                                className="h-7 text-xs bg-slate-900 text-white font-medium"
                              >
                                Collect Payment
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {payments.length > 0 && (
              <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div className="p-3 bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-emerald-600" />
                  Payment Receipts ({payments.length})
                </div>
                <div className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <div key={p.id} className="p-3 flex items-center justify-between text-xs">
                      <div className="space-y-0.5">
                        <div className="font-semibold text-slate-800">
                          {formatCurrency(p.amount)}{" "}
                          <span className="uppercase font-semibold text-[10px] text-slate-500">
                            via {p.paymentMethod.replace("_", " ")}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {p.transactionReference} ·{" "}
                          {invoices.find((i) => i.id === p.invoiceId)?.invoiceNumber ?? p.invoiceId}
                        </div>
                      </div>
                      <div className="text-right text-[11px] text-slate-500">
                        {formatDateTime(p.paidAt)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        )}

        {/* 5. QUOTATIONS (super_admin) */}
        {isSuper && (
          <TabsContent value="quotations" className="space-y-4">
            {quotes.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No quotations"
                description="Quotations raised for this customer appear here; accepted ones convert into bookings."
              />
            ) : (
              <div className="rounded-lg border border-slate-200 bg-white shadow-xs overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {quotes.map((q) => (
                    <div
                      key={q.id}
                      className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/60"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">{q.quoteNumber}</span>
                          <span className="px-2 py-0.2 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-800">
                            {q.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Valid until: {formatDate(q.validUntil)}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <div className="text-base font-bold text-slate-900">
                            {formatCurrency(q.total)}
                          </div>
                          <div className="text-[11px] text-slate-400">Subtotal + Tax</div>
                        </div>
                        {q.status === "sent" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleConvertQuote(q)}
                            className="text-xs h-8 border-slate-300"
                          >
                            Convert to Invoice
                          </Button>
                        )}
                        {q.status === "sent" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDeleteQuote(q)}
                            className="text-xs h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200"
                            title="Delete open quotation"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Edit Customer */}
      <CustomerFormDialog
        open={isEditOpen}
        onOpenChange={setIsEditOpen}
        partners={partners}
        editing={customer}
        onSubmit={handleSaveCustomer}
      />

      {/* Add / Edit Property */}
      <PropertyFormDialog
        open={propertyDialog.open}
        onOpenChange={(open) => setPropertyDialog({ open, editing: open ? propertyDialog.editing : null })}
        customers={[customer]}
        editing={propertyDialog.editing}
        defaultCustomerId={customerId}
        onSubmit={handlePropertySubmit}
      />

      {/* Delete Customer Confirmation */}
      <ConfirmModal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Customer"
        description={`Permanently delete ${customer.name}? Customers with booking history cannot be deleted — deactivate them instead.`}
        confirmText="Delete Customer"
      />

      {/* Delete Property Confirmation */}
      <ConfirmModal
        isOpen={deletePropertyTarget !== null}
        onClose={() => setDeletePropertyTarget(null)}
        onConfirm={handleDeletePropertyConfirm}
        title="Delete Property"
        description={`Permanently delete "${deletePropertyTarget?.title ?? "this property"}"? Properties linked to booked jobs cannot be deleted.`}
        confirmText="Delete Property"
      />

      {/* Collect Payment Dialog */}
      <Dialog open={!!payInvoice} onOpenChange={(open) => !open && setPayInvoice(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment Settlement</DialogTitle>
            <DialogDescription>
              Record customer payment for outstanding tax invoice.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handlePaymentSubmit} className="space-y-4 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Settlement Amount (₹) *</label>
              <Input
                type="number"
                value={payAmount}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPayAmount(e.target.value === "" ? 0 : Number(e.target.value))}
                required
                className="text-xs font-bold"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Payment Instrument</label>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
              >
                <option value="upi">UPI (GPay / PhonePe / Paytm)</option>
                <option value="card">Credit / Debit Card</option>
                <option value="bank_transfer">Direct Bank Transfer</option>
                <option value="cash">Cash on Handover</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Transaction Reference ID *</label>
              <Input
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                required
                className="text-xs font-mono"
              />
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button type="button" variant="outline" size="sm" onClick={() => setPayInvoice(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-slate-900 text-white" disabled={isSubmittingPayment}>
                {isSubmittingPayment ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Recording...
                  </>
                ) : (
                  "Record Payment"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
