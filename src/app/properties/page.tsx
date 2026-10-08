"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { JobStatusBadge } from "@/components/common/JobStatusBadge";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";
import {
  Building2,
  MapPin,
  Plus,
  Search,
  KeyRound,
  Car,
  Clock,
  History,
  Edit2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import {
  PropertyFormDialog,
  type PropertyFormPayload,
} from "@/components/common/PropertyFormDialog";
import { DataTable } from "@/components/ui/data-table";
import { Notice, SkeletonList } from "@/components/ui/states";
import { PropertyQrCard } from "@/components/common/PropertyQrCard";
import type { Property } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function PropertiesPage() {
  const { properties, customers, jobs, createProperty, updateProperty, deleteProperty, loading } = useApp();
  const { can } = useAuth();

  const [searchQuery, setSearchQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [detailPropertyId, setDetailPropertyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [actionError, setActionError] = useState("");

  const canEdit = can("properties.update");
  const canDelete = can("properties.delete");

  const filteredProperties = properties.filter(
    (p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const openCreate = () => {
    setActionError("");
    setEditingProperty(null);
    setFormOpen(true);
  };

  const openEdit = (p: Property) => {
    setActionError("");
    setEditingProperty(p);
    setFormOpen(true);
  };

  const handleFormSubmit = async (
    payload: PropertyFormPayload
  ): Promise<{ success: boolean; message: string }> => {
    const result = editingProperty
      ? await updateProperty(editingProperty.id, payload)
      : await createProperty(payload);
    return { success: result.success, message: result.message };
  };

  const detailProperty = detailPropertyId
    ? properties.find((p) => p.id === detailPropertyId) ?? null
    : null;

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setActionError("");
    const result = await deleteProperty(deleteTarget.id);
    if (!result.success) {
      setActionError(result.message);
    }
  };

  const ownerOf = (id: string) => customers.find((c) => c.id === id);

  return (
    <AdminLayout>
      <PageHeader
        title="Properties"
        description={`${properties.length} propert${properties.length === 1 ? "y" : "ies"} · tap one for access notes, history and the optional property QR`}
        actions={can("properties.create") ? <Button onClick={openCreate}><Plus className="h-5 w-5" aria-hidden /> Add Property</Button> : undefined}
      />
      <div className="relative mb-5 max-w-md">
        <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
        <Input type="search" placeholder="Search name, address or city" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" aria-label="Search properties" />
      </div>
      {actionError && <Notice tone="error" className="mb-4">{actionError}</Notice>}

      {loading && properties.length === 0 ? (
        <SkeletonList rows={4} />
      ) : properties.length === 0 ? (
        <EmptyState icon={Building2} title="No properties yet" description="Add a property for a customer before booking a job." actionLabel={can("properties.create") ? "Add property" : undefined} onAction={openCreate} />
      ) : filteredProperties.length === 0 ? (
        <EmptyState icon={Search} title="No matching properties" description="Try a different name or address." />
      ) : (
        <DataTable
          caption="Properties"
          rows={filteredProperties}
          rowKey={(p) => p.id}
          columns={[
            { key: "title", header: "Property", mobile: "title", cell: (p) => <button onClick={() => setDetailPropertyId(p.id)} className="font-semibold text-zinc-950 hover:text-rose-600 text-left">{p.title}</button> },
            { key: "address", header: "Address", mobile: "subtitle", cell: (p) => <span className="break-words">{p.address}{p.city ? `, ${p.city}` : ""}</span> },
            { key: "owner", header: "Customer", cell: (p) => { const o = ownerOf(p.customerId); return o ? <Link href={`/customers/${o.id}`} className="text-rose-600 font-medium">{o.name}</Link> : "—"; } },
            { key: "type", header: "Type", cell: (p) => <span className="capitalize">{p.propertyType}</span> },
            { key: "jobs", header: "Jobs", cell: (p) => jobs.filter((j) => j.propertyId === p.id).length },
          ]}
          actions={(p) => <Button variant="outline" size="sm" onClick={() => setDetailPropertyId(p.id)}>Details</Button>}
        />
      )}

      <PropertyFormDialog open={formOpen} onOpenChange={setFormOpen} customers={customers} editing={editingProperty} onSubmit={handleFormSubmit} />

      <Dialog open={detailProperty !== null} onOpenChange={(open) => !open && setDetailPropertyId(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailProperty && (
            <>
              <DialogHeader>
                <DialogTitle>{detailProperty.title}</DialogTitle>
                <DialogDescription>{detailProperty.address}{detailProperty.city ? `, ${detailProperty.city}` : ""}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                {(() => {
                  const owner = ownerOf(detailProperty.customerId);
                  return owner ? (
                    <Link href={`/customers/${owner.id}`} className="flex items-center justify-between rounded-xl border border-zinc-200 px-4 py-3">
                      <span><span className="block text-xs text-zinc-500">Customer</span><span className="block text-sm font-semibold text-zinc-950">{owner.name}</span></span>
                      <span className="text-sm text-zinc-500">{owner.phone}</span>
                    </Link>
                  ) : null;
                })()}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[["Bedrooms", detailProperty.bedrooms ?? 0], ["Bathrooms", detailProperty.bathrooms ?? 0], ["Sq ft", detailProperty.carpetAreaSqFt ?? 0]].map(([l, v]) => (
                    <div key={String(l)} className="rounded-xl bg-zinc-50 py-3"><div className="text-lg font-semibold text-zinc-950">{v}</div><div className="text-xs text-zinc-500">{l}</div></div>
                  ))}
                </div>
                {[["Access", detailProperty.accessNotes], ["Parking", detailProperty.parkingInstructions], ["Preferred time", detailProperty.preferredTime]].filter(([, v]) => v).map(([l, v]) => (
                  <div key={String(l)} className="rounded-xl bg-zinc-50 px-4 py-3 text-sm"><span className="font-semibold text-zinc-900">{l}: </span><span className="text-zinc-700">{v}</span></div>
                ))}
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950 mb-2">Jobs at this property</h3>
                  {(() => {
                    const list = jobs.filter((j) => j.propertyId === detailProperty.id);
                    return list.length === 0 ? (
                      <p className="text-sm text-zinc-500">No jobs yet.</p>
                    ) : (
                      <ul className="rounded-xl border border-zinc-200 divide-y divide-zinc-100">
                        {list.map((j) => (
                          <li key={j.id}>
                            <Link href={`/jobs/${j.id}`} className="flex items-center justify-between gap-2 px-4 py-3">
                              <span className="text-sm text-zinc-900">{formatDate(j.scheduledDate)}</span>
                              <JobStatusBadge status={j.status} size="sm" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </div>
                {canEdit && <PropertyQrCard propertyId={detailProperty.id} propertyTitle={detailProperty.title} />}
              </div>
              <DialogFooter>
                {canDelete && (
                  <Button variant="ghost" className="text-red-700" onClick={() => { const t = detailProperty; setDetailPropertyId(null); setActionError(""); setDeleteTarget({ id: t.id, title: t.title }); }}>
                    <Trash2 className="h-4 w-4" aria-hidden /> Delete
                  </Button>
                )}
                {canEdit && (
                  <Button variant="outline" onClick={() => { const t = detailProperty; setDetailPropertyId(null); openEdit(t); }}>
                    <Edit2 className="h-4 w-4" aria-hidden /> Edit
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete property?"
        description={`"${deleteTarget?.title ?? "This property"}" will be removed. Properties with jobs can't be deleted.`}
        confirmText="Delete"
      />
    </AdminLayout>
  );
}
