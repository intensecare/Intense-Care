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

const LocationsMap = dynamic(() => import("@/components/common/LocationsMap").then((m) => m.LocationsMap), { ssr: false });
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
import dynamic from "next/dynamic";
import { LocationPicker } from "@/components/common/LocationPicker";
import { formatAddress, hasCoords, LOCATION_SOURCE_LABEL, type PropertyLocationSource } from "@/lib/location";
import { cn, formatDateTime } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import {
  PropertyFormDialog,
  type PropertyFormPayload,
} from "@/components/common/PropertyFormDialog";
import { DataTable } from "@/components/ui/data-table";
import { Notice, SkeletonList } from "@/components/ui/states";
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
  const [view, setView] = useState<"list" | "map">("list");
  const [pinFilter, setPinFilter] = useState<"all" | "missing">("all");

  const canEdit = can("properties.update");
  const canDelete = can("properties.delete");

  const q = searchQuery.trim().toLowerCase();
  const filteredProperties = properties.filter(
    (p) =>
      (pinFilter === "all" || !hasCoords(p)) &&
      [p.title, p.address, p.city, p.locality, p.postalCode, p.state].some((v) => (v ?? "").toLowerCase().includes(q))
  );
  const missingPins = properties.filter((p) => !hasCoords(p)).length;

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
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" aria-hidden />
          <Input type="search" placeholder="Search name, address, area, city or PIN" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" aria-label="Search properties" />
        </div>
        <div className="flex gap-2" role="group" aria-label="View">
          {(["list", "map"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("min-h-11 px-4 rounded-xl border text-sm font-semibold capitalize", view === v ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700")}>{v}</button>
          ))}
          <button type="button" aria-pressed={pinFilter === "missing"} onClick={() => setPinFilter(pinFilter === "missing" ? "all" : "missing")} className={cn("min-h-11 px-4 rounded-xl border text-sm font-semibold", pinFilter === "missing" ? "border-amber-600 bg-amber-50 text-amber-900" : "border-zinc-300 bg-white text-zinc-700")}>
            No pin ({missingPins})
          </button>
        </div>
      </div>
      {missingPins > 0 && pinFilter === "all" && (
        <Notice tone="warning" className="mb-4">{missingPins} propert{missingPins === 1 ? "y has" : "ies have"} no saved map pin — navigation falls back to the address text and GPS job starts can&apos;t run there. Use “No pin” to find and fix them.</Notice>
      )}
      {view === "map" && filteredProperties.length > 0 && (
        <div className="mb-5 space-y-2">
          <LocationsMap points={filteredProperties.map((p) => ({ id: p.id, lat: p.lat, lng: p.lng, title: p.title, subtitle: formatAddress(p) }))} onSelect={(id) => setDetailPropertyId(id)} />
          <p className="text-xs text-zinc-500">Tap a pin to open that property. {filteredProperties.filter((p) => !hasCoords(p)).length} without a pin {filteredProperties.some((p) => !hasCoords(p)) ? "are listed below but not drawn" : ""}.</p>
        </div>
      )}
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
            { key: "address", header: "Address", mobile: "subtitle", cell: (p) => <span className="break-words">{formatAddress(p)}</span> },
            { key: "pin", header: "Map pin", cell: (p) => hasCoords(p) ? <span className="inline-flex items-center gap-1 text-emerald-700 text-sm"><MapPin className="h-4 w-4" aria-hidden /> Saved</span> : <span className="inline-flex items-center gap-1 text-amber-800 text-sm"><MapPin className="h-4 w-4" aria-hidden /> Missing</span> },
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
                <DialogDescription>{formatAddress(detailProperty)}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <section className="space-y-2" aria-label="Saved location">
                  <LocationPicker key={`${detailProperty.id}:${detailProperty.lat},${detailProperty.lng}`} value={{ lat: detailProperty.lat ?? null, lng: detailProperty.lng ?? null, address: formatAddress(detailProperty) }} readOnly height={180} />
                  {hasCoords(detailProperty) && (
                    <p className="text-xs text-zinc-500">
                      {detailProperty.locationSource ? `Set by: ${LOCATION_SOURCE_LABEL[detailProperty.locationSource as PropertyLocationSource] ?? detailProperty.locationSource}` : ""}
                      {detailProperty.locationUpdatedAt ? ` · updated ${formatDateTime(detailProperty.locationUpdatedAt)}` : ""}
                      {detailProperty.locationVerifiedAt ? ` · confirmed on site ${formatDateTime(detailProperty.locationVerifiedAt)}` : ""}
                    </p>
                  )}
                  {detailProperty.locationNotes && <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm"><span className="font-semibold text-zinc-900">Location notes: </span><span className="text-zinc-700">{detailProperty.locationNotes}</span></p>}
                </section>
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
