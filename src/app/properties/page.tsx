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
  const { properties, customers, jobs, createProperty, updateProperty, deleteProperty } = useApp();
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

  return (
    <AdminLayout>
      <PageHeader
        title="Managed Properties Directory"
        description="Comprehensive facility register: villas, apartments, duplexes, and commercial spaces with gate security access instructions, GPS telemetry, and recurring schedules."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Properties" },
        ]}
        actions={
          <Button
            onClick={openCreate}
            size="sm"
            className="h-9 gap-1.5 bg-rose-500 text-white font-medium"
          >
            <Plus className="h-4 w-4" />
            Register Property
          </Button>
        }
      />

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 mb-5 shadow-xs">
        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by property title, address, or locality..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 bg-slate-50 border-slate-200"
          />
        </div>
        {actionError && (
          <p className="mt-2 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5 max-w-md">
            {actionError}
          </p>
        )}
      </div>

      {filteredProperties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={properties.length === 0 ? "No properties registered yet" : "No properties match your search"}
          description={
            properties.length === 0
              ? "Register residences, villas, apartments, or commercial facilities to store gate access codes, GPS telemetry, and parking notes for field workers."
              : "Try refining your search keywords or register a new property."
          }
          actionLabel="Register Property"
          onAction={openCreate}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProperties.map((p) => {
            const owner = customers.find((c) => c.id === p.customerId);

            return (
              <div
                key={p.id}
                onClick={() => setDetailPropertyId(p.id)}
                className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all space-y-3 cursor-pointer"
                title="Open property details"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 text-sm">{p.title}</span>
                    <span className="capitalize px-2 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700">
                      {p.propertyType}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {p.recurringService && (
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        Recurring Clean: {p.recurringFrequency || "Monthly"}
                      </span>
                    )}
                    {(canEdit || canDelete) && (
                      <>
                        {canEdit && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(p);
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
                            className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActionError("");
                              setDeleteTarget({ id: p.id, title: p.title });
                            }}
                            title="Delete property"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                    <span>{p.address} ({p.city})</span>
                  </div>

                  <div className="text-[11px] text-slate-400">
                    Owner / Client: <strong className="text-slate-800">{owner?.name || "Client"}</strong> ({owner?.phone})
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center gap-3 pt-1">
                    <span>{p.bedrooms || 3} Bedrooms</span>
                    <span>•</span>
                    <span>{p.carpetAreaSqFt || 2000} sq ft</span>
                    <span>•</span>
                    <span className="font-mono text-slate-400">GPS: {p.gpsCoordinates.lat}, {p.gpsCoordinates.lng}</span>
                  </div>
                </div>

                {/* Access & Parking notes for on-site staff */}
                <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
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
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Register / Edit Property (shared dialog) */}
      <PropertyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customers={customers}
        editing={editingProperty}
        onSubmit={handleFormSubmit}
      />

      {/* Property Detail Dialog */}
      <Dialog open={detailProperty !== null} onOpenChange={(open) => !open && setDetailPropertyId(null)}>
        <DialogContent className="sm:max-w-lg">
          {detailProperty && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4 text-blue-600" />
                  {detailProperty.title}
                  <span className="capitalize px-2 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700">
                    {detailProperty.propertyType}
                  </span>
                </DialogTitle>
                <DialogDescription>
                  Full property record: owner, access instructions and booking history.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 py-2 text-xs max-h-[60vh] overflow-y-auto">
                <div className="flex items-start gap-1.5 text-slate-600">
                  <MapPin className="h-3.5 w-3.5 text-zinc-400 shrink-0 mt-0.5" />
                  <span>
                    {detailProperty.address}
                    {detailProperty.city ? ` (${detailProperty.city})` : ""}
                    {detailProperty.postalCode ? ` ${detailProperty.postalCode}` : ""}
                  </span>
                </div>

                {(() => {
                  const owner = customers.find((c) => c.id === detailProperty.customerId);
                  return owner ? (
                    <Link
                      href={`/customers/${owner.id}`}
                      className="block p-2.5 rounded-lg border border-slate-100 bg-slate-50/70 hover:border-slate-300 transition-colors"
                    >
                      <span className="text-[11px] text-slate-400">Owner / Client</span>
                      <div className="font-semibold text-slate-800">
                        {owner.name} <span className="font-mono text-slate-500">({owner.phone})</span>
                      </div>
                    </Link>
                  ) : null;
                })()}

                <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500">
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <strong className="text-slate-800">{detailProperty.bedrooms ?? 3}</strong> Bedrooms
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <strong className="text-slate-800">{detailProperty.bathrooms ?? 2}</strong> Bathrooms
                  </div>
                  <div className="p-2 rounded bg-slate-50 border border-slate-100">
                    <strong className="text-slate-800">{detailProperty.carpetAreaSqFt ?? 1000}</strong> sq ft
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 text-[11px]">
                  {detailProperty.accessNotes && (
                    <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600">
                      <strong className="text-slate-800 flex items-center gap-1">
                        <KeyRound className="h-3 w-3 text-amber-500" />
                        Access:
                      </strong>
                      {detailProperty.accessNotes}
                    </div>
                  )}
                  {detailProperty.parkingInstructions && (
                    <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600">
                      <strong className="text-slate-800 flex items-center gap-1">
                        <Car className="h-3 w-3 text-blue-500" />
                        Parking:
                      </strong>
                      {detailProperty.parkingInstructions}
                    </div>
                  )}
                  {detailProperty.preferredTime && (
                    <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600 flex items-center gap-1">
                      <Clock className="h-3 w-3 text-slate-400" />
                      <strong className="text-slate-800">Preferred time:</strong>
                      {detailProperty.preferredTime}
                    </div>
                  )}
                  {detailProperty.recurringService && (
                    <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800">
                      <strong>Recurring clean:</strong> {detailProperty.recurringFrequency || "monthly"}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <h4 className="text-[11px] font-semibold text-slate-500 flex items-center gap-1.5">
                    <History className="h-3 w-3" />
                    Booking History
                  </h4>
                  {(() => {
                    const propertyJobs = jobs.filter((j) => j.propertyId === detailProperty.id);
                    if (propertyJobs.length === 0) {
                      return (
                        <p className="text-[11px] text-slate-400">
                          No bookings recorded for this property yet.
                        </p>
                      );
                    }
                    return (
                      <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                        {propertyJobs.map((j) => (
                          <div key={j.id} className="p-2.5 flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-800">
                                {formatDate(j.scheduledDate)}
                              </div>
                              <div className="text-[10px] text-slate-400">{j.scheduledTimeSlot}</div>
                            </div>
                            <JobStatusBadge status={j.status} />
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                <div className="text-[10px] text-slate-400">
                  Registered: {formatDate(detailProperty.createdAt)}
                </div>
              </div>

              <DialogFooter className="pt-3 border-t border-slate-100">
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      const target = detailProperty;
                      setDetailPropertyId(null);
                      openEdit(target);
                    }}
                  >
                    <Edit2 className="h-3.5 w-3.5 mr-1" />
                    Edit Property
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-200"
                    onClick={() => {
                      const target = detailProperty;
                      setDetailPropertyId(null);
                      setActionError("");
                      setDeleteTarget({ id: target.id, title: target.title });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setDetailPropertyId(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Property Confirmation */}
      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Property"
        description={`Permanently delete "${deleteTarget?.title ?? "this property"}"? Properties linked to booked jobs cannot be deleted.`}
        confirmText="Delete Property"
      />
    </AdminLayout>
  );
}
