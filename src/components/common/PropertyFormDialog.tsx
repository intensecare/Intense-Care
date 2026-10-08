"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LocationPicker } from "@/components/common/LocationPicker";
import type { Customer, Property } from "@/lib/types";

export interface PropertyFormPayload {
  customerId: string;
  title: string;
  propertyType: Property["propertyType"];
  address: string;
  city: string;
  /** §1 The property pin. Jobs here start from it and are GPS-verified against it. */
  lat?: number;
  lng?: number;
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
  // §1 The map pin for this property.
  const [lat, setLat] = useState<number | undefined>(undefined);
  const [lng, setLng] = useState<number | undefined>(undefined);
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
    setLat(editing?.lat);
    setLng(editing?.lng);
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
      lat,
      lng,
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

  const num = (set: (n: number) => void) => (e: React.ChangeEvent<HTMLInputElement>) =>
    set(e.target.value === "" ? 0 : Number(e.target.value));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit property" : "Add property"}</DialogTitle>
            <DialogDescription>Where the service happens and how the team gets in.</DialogDescription>
          </DialogHeader>

          {error && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">{error}</div>}

          <Field label="Customer" required>
            <SearchableSelect value={customerId} onChange={setCustomerId} options={customerOptions} placeholder="Select a customer" required name="customerId" />
          </Field>

          <Field label="Property name" required htmlFor="pf-title" hint="How the team will recognise it">
            <Input id="pf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sobha Dream Acres 3BHK" required />
          </Field>

          <Field label="Address" required htmlFor="pf-address">
            <Input id="pf-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Flat, tower, community, locality" required autoComplete="street-address" />
          </Field>

          {/* §1 The pin. Set it once here and every job at this property can
              be GPS-verified from the start. */}
          <LocationPicker
            addressLabel="Confirm the address on the map"
            value={{ address, lat, lng }}
            onChange={(next) => {
              setAddress(next.address);
              setLat(next.lat);
              setLng(next.lng);
            }}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field label="City" htmlFor="pf-city">
              <Input id="pf-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
            </Field>
            <Field label="Postal code" htmlFor="pf-pin">
              <Input id="pf-pin" inputMode="numeric" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="560102" autoComplete="postal-code" />
            </Field>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-950">Size</legend>
            <Field label="Type" htmlFor="pf-type">
              <select id="pf-type" value={propertyType} onChange={(e) => setPropertyType(e.target.value as PropertyFormPayload["propertyType"])} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
                <option value="apartment">Apartment</option>
                <option value="villa">Villa</option>
                <option value="duplex">Duplex</option>
                <option value="penthouse">Penthouse</option>
                <option value="office">Office</option>
                <option value="commercial">Commercial</option>
              </select>
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Bedrooms" htmlFor="pf-bed">
                <Input id="pf-bed" type="number" inputMode="numeric" min={0} value={bedrooms} onFocus={(e) => e.target.select()} onChange={num(setBedrooms)} />
              </Field>
              <Field label="Bathrooms" htmlFor="pf-bath">
                <Input id="pf-bath" type="number" inputMode="numeric" min={0} value={bathrooms} onFocus={(e) => e.target.select()} onChange={num(setBathrooms)} />
              </Field>
              <Field label="Sq ft" htmlFor="pf-sqft">
                <Input id="pf-sqft" type="number" inputMode="numeric" min={0} value={sqFt} onFocus={(e) => e.target.select()} onChange={num(setSqFt)} />
              </Field>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold text-zinc-950">Access</legend>
            <Field label="Entry instructions" htmlFor="pf-access">
              <Input id="pf-access" value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="e.g. Visitor pass at gate 2" />
            </Field>
            <Field label="Parking" htmlFor="pf-parking">
              <Input id="pf-parking" value={parking} onChange={(e) => setParking(e.target.value)} placeholder="e.g. Basement 2 visitor parking" />
            </Field>
            <Field label="Preferred time" htmlFor="pf-time">
              <Input id="pf-time" value={preferredTime} onChange={(e) => setPreferredTime(e.target.value)} placeholder="e.g. Mornings after 10 AM" />
            </Field>
          </fieldset>

          <div className="rounded-xl border border-zinc-200 p-4 space-y-3">
            <label className="flex items-center gap-3 text-sm font-medium text-zinc-900 min-h-6">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} className="h-5 w-5 accent-rose-500" />
              Regular cleaning
            </label>
            {recurring && (
              <Field label="How often" htmlFor="pf-freq">
                <select id="pf-freq" value={recurringFrequency} onChange={(e) => setRecurringFrequency(e.target.value as PropertyFormPayload["recurringFrequency"])} className="w-full h-11 rounded-xl border border-zinc-300 px-3 bg-white text-sm">
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Every 3 months</option>
                </select>
              </Field>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting} disabled={!title.trim() || !address.trim() || !customerId}>
              {isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add property"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
