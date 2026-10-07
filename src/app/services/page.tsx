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

  // New Rubric Item State
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
      // Rubric starts empty — the company authors every checklist item.
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
    setIsEditOpen(true);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Service Packages & Checklist Rubrics"
        description="Configure deep cleaning service packages, base pricing, duration benchmarks, and standard operating quality rubrics."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Services & Checklists" },
        ]}
        actions={
          can("services.manage") && (
            <Button
              onClick={() => {
                setName("");
                setDescription("");
                setBasePrice(5000);
                setEstimatedDurationHours(4);
                setIsCreateOpen(true);
              }}
              size="sm"
              className="h-9 gap-1.5 bg-rose-500 text-white font-medium"
            >
              <Plus className="h-4 w-4" />
              Create Service Package
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Services List */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-500">
            Active Service Packages ({services.length})
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

                  <div className="text-[11px] pt-1 flex items-center justify-between border-t border-slate-100/20">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      ~{srv.estimatedDurationHours} hours
                    </span>
                    <span>{srv.checklistTemplate.length} rubric steps</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Service Details & Rubric */}
        <div className="lg:col-span-2 space-y-4">
          {!selectedService ? (
            <div className="bg-white rounded-lg border border-dashed border-slate-300 p-10 text-center space-y-2">
              <Sparkles className="h-8 w-8 text-slate-300 mx-auto" />
              <h3 className="text-sm font-semibold text-slate-700">No service packages yet</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Your catalog starts empty. Create your first service package with its own pricing and
                checklist rubric — everything here is authored by your company, nothing is preset.
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
                    setIsCreateOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Create Service Package
                </Button>
              )}
            </div>
          ) : (
          <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                  {selectedService.category}
                </span>
                <h2 className="text-base font-semibold text-slate-900 mt-1">
                  {selectedService.name} Rubric Standard
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {selectedService.description}
                </p>
              </div>

              <div className="text-right space-y-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {formatCurrency(selectedService.basePrice)}
                  </div>
                  <div className="text-[11px] text-slate-400">Base Starting Rate</div>
                </div>

                {can("services.manage") && (
                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={openEditModal}
                      className="h-7 text-xs gap-1"
                    >
                      <Edit2 className="h-3 w-3" />
                      Edit Package
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

            {/* Checklist Rubric Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-700">
                  Standard Checklist Rubric ({selectedService.checklistTemplate.length} Tasks)
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
                    Add Rubric Task
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
                      <span className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-semibold text-[10px] shrink-0 mt-0.5">
                        {idx + 1}
                      </span>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-900 px-1.5 py-0.2 rounded bg-slate-200/70 text-[10px]">
                            {item.area}
                          </span>
                          {item.critical && (
                            <span className="text-[9px] font-semibold text-red-700 bg-red-50 px-1 rounded border border-red-200">
                              Mandatory Rubric
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
                          title="Remove rubric item"
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

      {/* Modal: Create Service Package */}
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
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Package Title</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Move-in Deep Cleaning"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                  >
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="specialized">Specialized</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Base Starting Price (₹)</label>
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
                <label className="font-semibold text-slate-700">Estimated Duration (Hours)</label>
                <Input
                  type="number"
                  value={estimatedDurationHours}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEstimatedDurationHours(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-200 p-2 text-xs"
                  placeholder="Service package summary..."
                />
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
                <label className="font-semibold text-slate-700">Package Title</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                  >
                    <option value="residential">Residential</option>
                    <option value="commercial">Commercial</option>
                    <option value="specialized">Specialized</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Base Starting Price (₹)</label>
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
                <label className="font-semibold text-slate-700">Estimated Duration (Hours)</label>
                <Input
                  type="number"
                  value={estimatedDurationHours}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setEstimatedDurationHours(e.target.value === "" ? "" : Number(e.target.value))}
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-200 p-2 text-xs"
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

      {/* Modal: Add Rubric Item */}
      {isAddItemOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Add Checklist Rubric Item</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsAddItemOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleAddItem} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Area / Room</label>
                <Input
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  placeholder="e.g. Kitchen, Restroom, Living Room"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Task Instruction</label>
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder="e.g. Degrease chimney hood and scrub backsplashes"
                  rows={2}
                  className="w-full rounded-md border border-slate-200 p-2 text-xs"
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
                  Mandatory Rubric Item (Cannot be skipped in field)
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
                    "Add to Rubric"
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
