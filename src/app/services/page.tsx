"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { Service } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { formatDuration } from "@/lib/documents";
import {
  Sparkles,
  Clock,
  CheckCircle2,
  Plus,
  Edit2,
  Trash2,
  X,
  ShieldCheck,
  PlusCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/ConfirmModal";

/**
 * §3 The services a deep-cleaning business usually sells, as one-tap starting
 * points for the form. They are suggestions, not a built-in catalog: nothing
 * exists until the company creates it, and every field stays editable.
 */
const SERVICE_SUGGESTIONS: { name: string; category: Service["category"]; custom?: boolean }[] = [
  { name: "Deep Cleaning", category: "residential" },
  { name: "Sofa Cleaning", category: "residential" },
  { name: "Carpet Cleaning", category: "residential" },
  { name: "Kitchen Cleaning", category: "residential" },
  { name: "Bathroom Cleaning", category: "residential" },
  { name: "Move-in Cleaning", category: "residential" },
  { name: "Move-out Cleaning", category: "residential" },
  { name: "Custom Service", category: "specialized", custom: true },
];

export default function ServicesPage() {
  const {
    services,
    currentRole,
    createService,
    updateService,
    deleteService,
    addChecklistItemToService,
    removeChecklistItemFromService,
  } = useApp();
  const { can } = useAuth();

  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);

  // New Service Form State
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Service["category"]>("residential");
  const [description, setDescription] = useState("");
  const [basePrice, setBasePrice] = useState<number | "">(5000);
  const [estimatedDurationHours, setEstimatedDurationHours] = useState<number | "">(4);
  // §3 Custom services: how the service is taxed, a desk-only note, and
  // whether Admin authored it as a one-off rather than a standing package.
  const [taxTreatment, setTaxTreatment] = useState<"GST" | "EXEMPT">("GST");
  const [internalNotes, setInternalNotes] = useState("");
  const [isCustom, setIsCustom] = useState(false);

  // New Checklist Item State
  const [area, setArea] = useState("Kitchen");
  const [task, setTask] = useState("");
  const [critical, setCritical] = useState(false);

  const selectedService = services.find((s) => s.id === selectedServiceId) || services[0];

  const handleCreateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);

    const result = await createService({
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      category,
      description,
      basePrice: Number(basePrice) || 5000,
      estimatedDurationHours: Number(estimatedDurationHours) || 4,
      taxTreatment,
      internalNotes: internalNotes.trim() || undefined,
      isCustom,
      // Checklist starts empty — the company authors every checklist item.
      checklistTemplate: [],
      active: true,
    });

    if (result.success && result.service) {
      setSelectedServiceId(result.service.id);
    }
    setIsCreateOpen(false);
    setName("");
    setDescription("");
    setIsCreating(false);
  };

  const handleUpdateService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedService) return;
    setIsUpdating(true);
    await updateService(selectedService.id, {
      name,
      category,
      description,
      basePrice: Number(basePrice) || 5000,
      estimatedDurationHours: Number(estimatedDurationHours) || 4,
      taxTreatment,
      internalNotes: internalNotes.trim(),
    });
    setIsEditOpen(false);
    setIsUpdating(false);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || !selectedService) return;
    setIsAddingItem(true);

    await addChecklistItemToService(selectedService.id, {
      area: area.trim() || "General",
      task,
      critical,
    });

    setTask("");
    setIsAddItemOpen(false);
    setIsAddingItem(false);
  };

  const openEditModal = () => {
    if (!selectedService) return;
    setName(selectedService.name);
    setCategory(selectedService.category);
    setDescription(selectedService.description);
    setBasePrice(selectedService.basePrice);
    setEstimatedDurationHours(selectedService.estimatedDurationHours);
    setTaxTreatment(selectedService.taxTreatment === "EXEMPT" ? "EXEMPT" : "GST");
    setInternalNotes(selectedService.internalNotes ?? "");
    setIsEditOpen(true);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Services"
        description="Each service has a price, an estimated duration and a checklist by room."
        actions={
          can("services.manage") && (
            <Button
              onClick={() => {
                setName("");
                setDescription("");
                setBasePrice(5000);
                setEstimatedDurationHours(4);
                setTaxTreatment("GST");
                setInternalNotes("");
                setIsCustom(false);
                setIsCreateOpen(true);
              }}
              size="sm"
              className="h-9 gap-1.5 bg-rose-500 text-white font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Service
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Services List */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500">
            Services ({services.length})
          </h3>

          <div className="space-y-2">
            {services.map((srv) => {
              const isSelected = srv.id === selectedServiceId;

              return (
                <div
                  key={srv.id}
                  onClick={() => setSelectedServiceId(srv.id)}
                  className={`p-4 rounded-lg border transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                      : "bg-white text-slate-800 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{srv.name}</span>
                    <span
                      className={`text-xs font-semibold ${
                        isSelected ? "text-amber-300" : "text-slate-900"
                      }`}
                    >
                      {formatCurrency(srv.basePrice)}
                    </span>
                  </div>

                  <p
                    className={`text-xs line-clamp-2 ${
                      isSelected ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {srv.description}
                  </p>

                  <div className="text-xs pt-1 flex items-center justify-between border-t border-slate-100/20">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDuration(srv.estimatedDurationHours)}
                    </span>
                    <span>{srv.checklistTemplate.length} checklist items</span>
                  </div>
                  {(srv.isCustom || srv.taxTreatment === "EXEMPT") && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {srv.isCustom && (
                        <span className={isSelected ? "text-xs font-semibold text-rose-300" : "text-xs font-semibold text-rose-600"}>
                          Custom service
                        </span>
                      )}
                      {srv.taxTreatment === "EXEMPT" && (
                        <span className={isSelected ? "text-xs font-semibold text-amber-300" : "text-xs font-semibold text-amber-700"}>
                          GST exempt
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Service Details & Checklist */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedService ? (
            <div className="bg-white rounded-lg border border-dashed border-slate-300 p-10 text-center space-y-2">
              <Sparkles className="h-8 w-8 text-slate-300 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-700">No service packages yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Your catalog starts empty. Create your first service package with its own pricing and
                checklist checklist — everything here is authored by your company, nothing is preset.
              </p>
              {can("services.manage") && (
                <Button
                  size="sm"
                  className="bg-slate-900 text-white mt-2"
                  onClick={() => {
                    setName("");
                    setDescription("");
                    setBasePrice(5000);
                    setEstimatedDurationHours(4);
                    setTaxTreatment("GST");
                    setInternalNotes("");
                    setIsCustom(false);
                    setIsCreateOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Service
                </Button>
              )}
            </div>
          ) : (
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                  {selectedService.category}
                </span>
                <h2 className="text-base font-semibold text-slate-900 mt-1">
                  {selectedService.name} 
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedService.description}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-600">
                    {selectedService.taxTreatment === "EXEMPT" ? "GST exempt" : "Taxable (GST)"}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{formatDuration(selectedService.estimatedDurationHours)}</span>
                  {selectedService.isCustom && (
                    <>
                      <span className="text-slate-400">·</span>
                      <span className="font-semibold text-rose-600">Custom service</span>
                    </>
                  )}
                </div>
                {selectedService.internalNotes && (
                  <p className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                    <span className="font-semibold">Internal: </span>
                    {selectedService.internalNotes}
                  </p>
                )}
              </div>

              <div className="text-right space-y-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {formatCurrency(selectedService.basePrice)}
                  </div>
                  <div className="text-xs text-slate-400">Starting price</div>
                </div>

                {can("services.manage") && (
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openEditModal}
                      className="gap-1"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit service
                    </Button>

                    {services.length > 1 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteConfirmOpen(true)}
                        className="h-7 text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Checklist Checklist Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-zinc-800">
                  Checklist ({selectedService.checklistTemplate.length} Tasks)
                </h4>

                {can("services.manage") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setArea("Kitchen");
                      setTask("");
                      setCritical(false);
                      setIsAddItemOpen(true);
                    }}
                    className="h-7 text-xs gap-1 border-dashed text-blue-700 border-blue-200 bg-blue-50/50"
                  >
                    <PlusCircle className="h-3.5 w-3.5" />
                    Add checklist item
                  </Button>
                )}
              </div>

              <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                {selectedService.checklistTemplate.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-3 flex items-start justify-between gap-3 text-xs bg-slate-50/50 hover:bg-white transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-semibold text-xs shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 px-1.5 py-0.2 rounded bg-slate-200/70 text-xs">
                            {item.area}
                          </span>
                          {item.critical && (
                            <span className="text-xs font-semibold text-red-700 bg-red-50 px-1 rounded border border-red-200">
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-slate-800 font-medium">{item.task}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                      {can("services.manage") && (
                        <button
                          onClick={() => removeChecklistItemFromService(selectedService.id, item.id)}
                          className="text-slate-400 hover:text-red-600 transition-colors p-1"
                          title="Remove checklist item"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          )}
        </div>
      </div>

      {/* Modal: Add Service */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Create New Service Package</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsCreateOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateService} className="space-y-3 text-xs">
              <div className="space-y-1.5">
                <span className="text-sm font-medium text-zinc-800">Start from</span>
                <div className="flex flex-wrap gap-1.5">
                  {SERVICE_SUGGESTIONS.map((s) => (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => {
                        setName(s.name);
                        setCategory(s.category);
                        setIsCustom(s.custom === true);
                      }}
                      className={
                        name === s.name
                          ? "min-h-9 rounded-lg border px-2.5 text-xs font-semibold border-rose-500 bg-rose-50 text-rose-700"
                          : "min-h-9 rounded-lg border px-2.5 text-xs font-medium border-zinc-300 bg-white text-zinc-700"
                      }
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Package Title</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Move-in Deep Cleaning"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm"
                  >
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="specialized">Specialized</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">Base Starting Price (₹)</label>
                  <Input
                    type="number"
                    value={basePrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setBasePrice(e.target.value === "" ? "" : Number(e.target.value))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Estimated Duration (Hours)</label>
                <Input
                  type="number"
                  value={estimatedDurationHours}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEstimatedDurationHours(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                  placeholder="e.g. Complete cleaning of newly constructed property"
                />
              </div>

              {/* §3 Tax treatment: an exempt service never carries GST, even
                  on a GST invoice. */}
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-zinc-800">Tax treatment</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["GST", "EXEMPT"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={taxTreatment === t}
                      onClick={() => setTaxTreatment(t)}
                      className={
                        taxTreatment === t
                          ? "min-h-11 rounded-xl border px-3 text-sm font-medium border-zinc-900 bg-zinc-900 text-white"
                          : "min-h-11 rounded-xl border px-3 text-sm font-medium border-zinc-300 bg-white text-zinc-700"
                      }
                    >
                      {t === "GST" ? "Taxable (GST)" : "GST exempt"}
                    </button>
                  ))}
                </div>
              </fieldset>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Internal notes</label>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                  placeholder="Desk-only. Equipment, staffing, anything the crew needs to prepare."
                />
                <p className="text-xs text-zinc-500">Never shown to a customer.</p>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={isCustom}
                  onChange={(e) => setIsCustom(e.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-rose-500"
                />
                <span>
                  Mark as a custom service
                  <span className="block text-xs text-zinc-500">
                    A one-off scope rather than a standing package. It is bookable and reportable either way.
                  </span>
                </span>
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="" disabled={isCreating}>
                  {isCreating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Package"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Service Package */}
      {isEditOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Edit Service Package</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsEditOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleUpdateService} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Package Title</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm"
                  >
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="specialized">Specialized</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800">Base Starting Price (₹)</label>
                  <Input
                    type="number"
                    value={basePrice}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setBasePrice(e.target.value === "" ? "" : Number(e.target.value))}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Estimated Duration (Hours)</label>
                <Input
                  type="number"
                  value={estimatedDurationHours}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEstimatedDurationHours(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                />
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-zinc-800">Tax treatment</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["GST", "EXEMPT"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={taxTreatment === t}
                      onClick={() => setTaxTreatment(t)}
                      className={
                        taxTreatment === t
                          ? "min-h-11 rounded-xl border px-3 text-sm font-medium border-zinc-900 bg-zinc-900 text-white"
                          : "min-h-11 rounded-xl border px-3 text-sm font-medium border-zinc-300 bg-white text-zinc-700"
                      }
                    >
                      {t === "GST" ? "Taxable (GST)" : "GST exempt"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500">
                  Applies to new bookings. Invoices already issued are never rewritten.
                </p>
              </fieldset>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Internal notes</label>
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                  placeholder="Desk-only. Never shown to a customer."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="" disabled={isUpdating}>
                  {isUpdating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Checklist Item */}
      {isAddItemOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Add Checklist Checklist Item</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsAddItemOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Area / Room</label>
                <Input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Kitchen, Restroom, Living Room"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800">Task Instruction</label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="e.g. Degrease chimney hood and scrub backsplashes"
                  rows={2}
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="crit"
                  checked={critical}
                  onChange={(e) => setCritical(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                />
                <label htmlFor="crit" className="font-medium text-slate-800">
                  Required Item (Cannot be skipped in field)
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAddItemOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="" disabled={isAddingItem}>
                  {isAddingItem ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add to Checklist"
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Package Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          if (!selectedService) return;
          void deleteService(selectedService.id);
          setSelectedServiceId("");
        }}
        title="Delete Service Package"
        description={`Are you sure you want to delete service package "${selectedService?.name ?? ""}"? This action cannot be undone.`}
        confirmText="Delete Package"
        cancelText="Cancel"
        variant="destructive"
      />
    </AdminLayout>
  );
}
