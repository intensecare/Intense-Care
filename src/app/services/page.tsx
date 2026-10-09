"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { Service } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
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

const GST_LABEL: Record<NonNullable<Service["gstTreatment"]>, string> = { DEFAULT: "GST (default)", GST: "GST", NON_GST: "Non-GST" };

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
  const [isCustom, setIsCustom] = useState(false);
  const [gstTreatment, setGstTreatment] = useState<NonNullable<Service["gstTreatment"]>>("DEFAULT");
  const [notes, setNotes] = useState("");
  const [tab, setTab] = useState<"standard" | "custom">("standard");

  // New Checklist Item State
  const [area, setArea] = useState("Kitchen");
  const [task, setTask] = useState("");
  const [critical, setCritical] = useState(false);

  const listed = services.filter((s) => (tab === "custom") === Boolean(s.isCustom));
  const selectedService = listed.find((s) => s.id === selectedServiceId) || listed[0];
  const resetForm = () => {
    setName("");
    setDescription("");
    setBasePrice(5000);
    setEstimatedDurationHours(4);
    setIsCustom(tab === "custom");
    setGstTreatment("DEFAULT");
    setNotes("");
  };

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
      isCustom,
      gstTreatment,
      notes: notes.trim(),
      // Checklist starts empty — the company authors every checklist item.
      checklistTemplate: [],
      active: true,
    });

    if (result.success && result.service) {
      setTab(isCustom ? "custom" : "standard");
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
      isCustom,
      gstTreatment,
      notes: notes.trim(),
    });
    setTab(isCustom ? "custom" : "standard");
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
    setIsCustom(Boolean(selectedService.isCustom));
    setGstTreatment(selectedService.gstTreatment ?? "DEFAULT");
    setNotes(selectedService.notes ?? "");
    setIsEditOpen(true);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Services"
        description="Standard services from your catalogue, and custom services made for one customer. Both work in quotations, jobs, invoices and reports."
        actions={
          can("services.manage") && (
            <Button
              onClick={() => {
                resetForm();
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
          <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Service type">
            {(["standard", "custom"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`min-h-11 rounded-xl border text-sm font-semibold ${tab === t ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}
              >
                {t === "standard" ? "Standard" : "Custom"} ({services.filter((x) => (t === "custom") === Boolean(x.isCustom)).length})
              </button>
            ))}
          </div>
          {listed.length === 0 && (
            <p className="text-sm text-zinc-500 px-1">
              {tab === "custom" ? "No custom services yet. Add one for work that isn't in your catalogue — or add a custom line to a quotation." : "No standard services yet."}
            </p>
          )}

          <div className="space-y-2">
            {listed.map((srv) => {
              const isSelected = srv.id === selectedService?.id;

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
                      ~{srv.estimatedDurationHours} hours
                    </span>
                    <span>{srv.checklistTemplate.length} checklist items</span>
                  </div>
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
                    resetForm();
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
                <span className="flex flex-wrap gap-1.5">
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">{selectedService.category}</span>
                  {selectedService.isCustom && <span className="text-xs font-semibold px-2 py-0.5 rounded bg-violet-50 text-violet-800">Custom</span>}
                  <span className="text-xs font-semibold px-2 py-0.5 rounded bg-zinc-100 text-zinc-700">{GST_LABEL[selectedService.gstTreatment ?? "DEFAULT"]}</span>
                </span>
                <h2 className="text-base font-semibold text-slate-900 mt-1">
                  {selectedService.name} 
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedService.description}
                </p>
                {selectedService.notes && <p className="mt-2 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-700"><span className="font-semibold">Notes:</span> {selectedService.notes}</p>}
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
              <h3 className="text-sm font-semibold text-slate-900">{isCustom ? "New custom service" : "New service"}</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsCreateOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateService} className="space-y-3 text-xs">
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
                  placeholder="Service package summary..."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="svc-new-gst">GST treatment</label>
                  <select id="svc-new-gst" value={gstTreatment} onChange={(e) => setGstTreatment(e.target.value as NonNullable<Service["gstTreatment"]>)} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
                    <option value="DEFAULT">Company default (GST)</option>
                    <option value="GST">Always GST</option>
                    <option value="NON_GST">Non-GST</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 min-h-11 sm:pt-6 text-sm font-medium text-zinc-800">
                  <input type="checkbox" checked={isCustom} onChange={(e) => setIsCustom(e.target.checked)} className="h-5 w-5 accent-rose-500" />
                  Custom service
                </label>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="svc-new-notes">Notes</label>
                <textarea id="svc-new-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" placeholder="Materials, access needs, anything the team should know" />
              </div>

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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="svc-edit-gst">GST treatment</label>
                  <select id="svc-edit-gst" value={gstTreatment} onChange={(e) => setGstTreatment(e.target.value as NonNullable<Service["gstTreatment"]>)} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
                    <option value="DEFAULT">Company default (GST)</option>
                    <option value="GST">Always GST</option>
                    <option value="NON_GST">Non-GST</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 min-h-11 sm:pt-6 text-sm font-medium text-zinc-800">
                  <input type="checkbox" checked={isCustom} onChange={(e) => setIsCustom(e.target.checked)} className="h-5 w-5 accent-rose-500" />
                  Custom service
                </label>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium text-zinc-800" htmlFor="svc-edit-notes">Notes</label>
                <textarea id="svc-edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" placeholder="Materials, access needs, anything the team should know" />
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
