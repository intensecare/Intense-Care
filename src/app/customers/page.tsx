"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { DataTable } from "@/components/ui/data-table";
import { Notice, SkeletonList } from "@/components/ui/states";
import {
  Users,
  Search,
  Plus,
  Building2,
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
  const { customers, properties, partners, createCustomer, updateCustomer, deleteCustomer, loading } = useApp();
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

  const propsOf = (id: string) => properties.filter((p) => p.customerId === id);

  return (
    <AdminLayout>
      <PageHeader
        title="Customers"
        description={`${customers.length} customer${customers.length === 1 ? "" : "s"}`}
        actions={can("customers.create") ? <Button onClick={openCreate}><Plus className="h-5 w-5" aria-hidden /> Add Customer</Button> : undefined}
      />

      <div className="relative mb-5 max-w-md">
        <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
        <Input type="search" placeholder="Search name, phone or email" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" aria-label="Search customers" />
      </div>

      {actionError && <Notice tone="error" className="mb-4">{actionError}</Notice>}

      {loading && customers.length === 0 ? (
        <SkeletonList rows={4} />
      ) : customers.length === 0 ? (
        <EmptyState icon={Users} title="No customers yet" description="Add your first customer, then book a job for them." actionLabel={can("customers.create") ? "Add customer" : undefined} onAction={openCreate} />
      ) : filteredCustomers.length === 0 ? (
        <EmptyState icon={Search} title="No matching customers" description="Try a different name or phone number." />
      ) : (
        <DataTable
          caption="Customers"
          rows={filteredCustomers}
          rowKey={(c) => c.id}
          href={(c) => `/customers/${c.id}`}
          columns={[
            { key: "name", header: "Customer", mobile: "title", cell: (c) => <span className="font-semibold text-zinc-950">{c.name}</span> },
            { key: "phone", header: "Phone", mobile: "subtitle", cell: (c) => c.phone },
            { key: "status", header: "Status", mobile: "badge", cell: (c) => <span className={c.status === "inactive" ? "inline-flex rounded-full bg-zinc-100 text-zinc-600 px-2.5 py-1 text-xs font-semibold" : "inline-flex rounded-full bg-emerald-50 text-emerald-800 px-2.5 py-1 text-xs font-semibold"}>{c.status === "inactive" ? "Inactive" : "Active"}</span> },
            { key: "props", header: "Properties", cell: (c) => { const ps = propsOf(c.id); return ps.length ? <span className="inline-flex items-center gap-1.5"><Building2 className="h-4 w-4 text-zinc-400" aria-hidden />{ps.length === 1 ? ps[0].title : `${ps.length} properties`}</span> : <span className="text-zinc-400">None</span>; } },
            { key: "jobs", header: "Jobs", cell: (c) => c.totalBookings ?? 0 },
          ]}
          actions={canEdit || canDelete ? (c) => (
            <>
              {canEdit && <Button variant="outline" size="sm" onClick={(e) => { e.preventDefault(); openEdit(c); }}><Edit2 className="h-4 w-4" aria-hidden /> Edit</Button>}
              {canDelete && <Button variant="ghost" size="sm" className="text-red-700" onClick={(e) => { e.preventDefault(); setDeleteTarget({ id: c.id, name: c.name }); }}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>}
            </>
          ) : undefined}
        />
      )}

      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} partners={partners} editing={editingCustomer} onSubmit={handleFormSubmit} />
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete customer?"
        description={`${deleteTarget?.name ?? "This customer"} will be removed. Customers with jobs can't be deleted.`}
        confirmText="Delete"
      />
    </AdminLayout>
  );
}
