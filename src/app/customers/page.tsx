"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatCurrency } from "@/lib/utils";
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  Building2,
  Share2,
  Edit2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import {
  CustomerFormDialog,
  type CustomerFormPayload,
} from "@/components/common/CustomerFormDialog";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const router = useRouter();
  const { customers, properties, partners, createCustomer, updateCustomer, deleteCustomer } = useApp();
  const { can } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [actionError, setActionError] = useState("");

  const canEdit = can("customers.update");
  const canDelete = can("customers.delete");

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openCreate = () => {
    setActionError("");
    setEditingCustomer(null);
    setFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setActionError("");
    setEditingCustomer(c);
    setFormOpen(true);
  };

  const handleFormSubmit = async (payload: CustomerFormPayload) => {
    const result = editingCustomer
      ? await updateCustomer(editingCustomer.id, { ...payload })
      : await createCustomer({ ...payload, referralPartnerId: payload.referralPartnerId || undefined });
    return { success: result.success, message: result.message };
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setActionError("");
    const result = await deleteCustomer(deleteTarget.id);
    if (!result.success) {
      setActionError(result.message);
    }
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Customer Directory & Multi-Property Accounts"
        description="Client contact records, WhatsApp routing, registered property portfolios, lifetime value, and referral source attribution."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Customers" },
        ]}
        actions={
          <Button
            onClick={openCreate}
            size="sm"
            className="h-9 gap-1.5 bg-rose-500 text-white font-medium"
          >
            <Plus className="h-4 w-4" />
            Register Customer
          </Button>
        }
      />

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 mb-5 shadow-xs">
        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by customer name, phone, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 bg-slate-50 border-slate-200"
          />
        </div>
        {actionError && (
          <p className="mt-2 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
            {actionError}
          </p>
        )}
      </div>

      {/* Customers List */}
      <div className="space-y-4">
        {filteredCustomers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={customers.length === 0 ? "No customers registered yet" : "No customers match your search"}
            description={
              customers.length === 0
                ? "Register residential or commercial property owners to track bookings, address access notes, and WhatsApp communication."
                : "Try clearing your search query or registering a new customer."
            }
            actionLabel="Register Customer"
            onAction={openCreate}
          />
        ) : (
          filteredCustomers.map((c) => {
            const custProps = properties.filter((p) => p.customerId === c.id);
            const partner = partners.find((p) => p.id === c.referralPartnerId);

            return (
              <div
                key={c.id}
                onClick={() => router.push(`/customers/${c.id}`)}
                className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all space-y-4 cursor-pointer"
                title="Open customer profile"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 text-base">{c.name}</span>
                      <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800">
                        {c.status}
                      </span>
                      {partner && (
                        <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 flex items-center gap-1">
                          <Share2 className="h-2.5 w-2.5" />
                          Ref: {partner.code}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-4 flex-wrap">
                      <span className="flex items-center gap-1 font-mono text-slate-700">
                        <Phone className="h-3 w-3 text-slate-400" />
                        {c.phone}
                      </span>
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3 text-slate-400" />
                        {c.email}
                      </span>
                      <span className="text-slate-400">Source: {c.source}</span>
                    </div>
                  </div>

                  <div className="text-left sm:text-right">
                    {(canEdit || canDelete) && (
                      <div className="flex sm:justify-end gap-1.5 mb-1.5">
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(c);
                            }}
                            title="Edit customer"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionError("");
                              setDeleteTarget({ id: c.id, name: c.name });
                            }}
                            title="Delete customer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )}
                    <div className="text-xs text-slate-400">Lifetime Revenue</div>
                    <div className="text-base font-semibold text-slate-900">
                      {typeof c.lifetimeRevenue === "number"
                        ? formatCurrency(c.lifetimeRevenue)
                        : "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">{c.totalBookings} Bookings</div>
                  </div>
                </div>

                {/* Registered Properties Grid */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-slate-500">
                    Registered Properties ({custProps.length})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {custProps.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 text-xs space-y-1"
                      >
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                          {p.title}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed truncate">
                          {p.address}
                        </p>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                          <span className="capitalize">{p.propertyType} • {p.bedrooms || 3} BHK</span>
                          {p.recurringService && (
                            <span className="text-blue-600 font-semibold">
                              Recurring: {p.recurringFrequency}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {c.notes && (
                  <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                    <strong>Notes:</strong> {c.notes}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Register / Edit Customer (shared dialog) */}
      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        partners={partners}
        editing={editingCustomer}
        onSubmit={handleFormSubmit}
      />

      {/* Delete Customer Confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Customer"
        description={`Permanently delete ${deleteTarget?.name ?? "this customer"}? Customers with booking history cannot be deleted — deactivate them instead.`}
        confirmText="Delete Customer"
      />
    </AdminLayout>
  );
}
