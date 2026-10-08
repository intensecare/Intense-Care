"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Customer, Property } from "@/lib/types";

export interface PropertyFormPayload {
  customerId: string;
  title: string;
  propertyType: Property["propertyType"];
  address: string;
  city: string;
  bedrooms: number;
  bathrooms: number;
  carpetAreaSqFt: number;
  accessNotes: string;
  parkingInstructions: string;
  recurringService: boolean;
  recurringFrequency?: "weekly" | "biweekly" | "monthly" | "quarterly";
}

interface PropertyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: Customer[];
  /** Property being edited, or null/undefined for create mode. */
  editing?: Property | null;
  /** Preselected owner for create mode (e.g. from the customer detail page). */
  defaultCustomerId?: string;
  onSubmit: (
    payload: PropertyFormPayload
  ) => Promise<{ success: boolean; message: string }>;
}

/**
 * Shared create/edit property form used by the Properties directory and the
 * customer detail page. Covers the full API contract including access notes,
 * parking, preferred time and recurring-service configuration.
 */
export function PropertyFormDialog({
  open,
  onOpenChange,
  customers,
  editing,
  defaultCustomerId,
  onSubmit,
}: PropertyFormDialogProps) {
  const isEditing = !!editing;

  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [propertyType, setPropertyType] = useState<PropertyFormPayload["propertyType"]>("apartment");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Bengaluru");
  const [postalCode, setPostalCode] = useState("");
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(2);
  const [sqFt, setSqFt] = useState(1800);
  const [accessNotes, setAccessNotes] = useState("");
  const [parking, setParking] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] =
    useState<PropertyFormPayload["recurringFrequency"]>("monthly");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the form whenever the dialog opens (create or edit target).
  useEffect(() => {
    if (!open) return;
    setError("");
    setCustomerId(editing?.customerId || defaultCustomerId || customers[0]?.id || "");
    setTitle(editing?.title ?? "");
    setPropertyType(editing?.propertyType || "apartment");
    setAddress(editing?.address ?? "");
    setCity(editing?.city || "Bengaluru");
    setPostalCode(editing?.postalCode ?? "");
    setBedrooms(editing?.bedrooms ?? 3);
    setBathrooms(editing?.bathrooms ?? 2);
    setSqFt(editing?.carpetAreaSqFt ?? 1800);
    setAccessNotes(editing?.accessNotes ?? "");
    setParking(editing?.parkingInstructions ?? "");
    setPreferredTime(editing?.preferredTime ?? "");
    setRecurring(editing?.recurringService ?? false);
    setRecurringFrequency(editing?.recurringFrequency ?? "monthly");
  }, [open, editing, defaultCustomerId, customers]);

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.phone})`,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !address || !customerId) return;
    setIsSubmitting(true);
    setError("");

    const result = await onSubmit({
      customerId,
      title,
      propertyType,
      address,
      city,
      bedrooms,
      bathrooms,
      carpetAreaSqFt: sqFt,
      accessNotes,
      parkingInstructions: parking,
      recurringService: recurring,
      recurringFrequency: recurring ? recurringFrequency : undefined,
    });

    setIsSubmitting(false);
    if (!result.success) {
      setError(result.message);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Property" : "Register Property"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the property details, gate access notes, or reassign its owner."
              : "Add a residence or commercial facility to customer's portfolio."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 py-2 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Linked Customer *</label>
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              placeholder="Select a customer"
              required
              name="customerId"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Property Nickname / Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="E.g., Sobha Dream Acres 3BHK"
              required
              className="text-xs"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Type</label>
              <select
                value={propertyType}
                onChange={(e) => setPropertyType(e.target.value as PropertyFormPayload["propertyType"])}
                className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
              >
                <option value="apartment">Apartment</option>
                <option value="villa">Villa</option>
                <option value="duplex">Duplex</option>
                <option value="penthouse">Penthouse</option>
                <option value="office">Commercial Office</option>
                <option value="commercial">Commercial</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Bedrooms</label>
              <Input
                type="number"
                value={bedrooms}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setBedrooms(e.target.value === "" ? 0 : Number(e.target.value))}
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Bathrooms</label>
              <Input
                type="number"
                value={bathrooms}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setBathrooms(e.target.value === "" ? 0 : Number(e.target.value))}
                className="text-xs"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Full Postal Address *</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Flat / Unit, Tower, Community, Locality..."
              required
              className="text-xs"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">City</label>
              <Input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Bengaluru"
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Area (sq ft)</label>
              <Input
                type="number"
                value={sqFt}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setSqFt(e.target.value === "" ? 0 : Number(e.target.value))}
                className="text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Access Instructions</label>
              <Input
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
                placeholder="E.g., Visitor pass code at gate 2"
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Parking Instructions</label>
              <Input
                value={parking}
                onChange={(e) => setParking(e.target.value)}
                placeholder="E.g., Basement 2 visitor parking"
                className="text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Preferred Service Time</label>
              <Input
                value={preferredTime}
                onChange={(e) => setPreferredTime(e.target.value)}
                placeholder="E.g., Mornings after 10 AM"
                className="text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Postal Code</label>
              <Input
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="560102"
                className="text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-4 pt-1">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="prop-recurring"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
              />
              <label htmlFor="prop-recurring" className="text-slate-700 font-medium">
                Recurring deep cleaning agreement
              </label>
            </div>
            {recurring && (
              <select
                value={recurringFrequency}
                onChange={(e) =>
                  setRecurringFrequency(e.target.value as PropertyFormPayload["recurringFrequency"])
                }
                className="h-8 rounded-md border border-slate-200 px-2 bg-white"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
              </select>
            )}
          </div>

          {error && (
            <p className="text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
              {error}
            </p>
          )}

          <DialogFooter className="pt-3 border-t border-slate-100">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : isEditing ? (
                "Save Changes"
              ) : (
                "Save Property"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
