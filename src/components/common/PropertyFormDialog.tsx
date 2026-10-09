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
import type { Customer, Property } from "@/lib/types";
import { LocationPicker, type LocationValue } from "./LocationPicker";

export interface PropertyFormPayload {
  customerId: string;
  title: string;
  propertyType: Property["propertyType"];
  address: string;
  addressLine: string;
  locality: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  bedrooms: number;
  bathrooms: number;
  carpetAreaSqFt: number;
  accessNotes: string;
  parkingInstructions: string;
  preferredTime: string;
  recurringService: boolean;
  recurringFrequency?: "weekly" | "biweekly" | "monthly" | "quarterly";
  /** Map location (optional). Both or neither. */
  lat: number | null;
  lng: number | null;
  locationNotes: string;
  locationSource?: LocationValue["source"];
  /** Edit only: the user removed the saved pin on purpose. */
  clearLocation?: boolean;
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
  const [addressLine, setAddressLine] = useState("");
  const [locality, setLocality] = useState("");
  const [city, setCity] = useState("Bengaluru");
  const [stateName, setStateName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("India");
  const [locationNotes, setLocationNotes] = useState("");
  const [bedrooms, setBedrooms] = useState(3);
  const [bathrooms, setBathrooms] = useState(2);
  const [sqFt, setSqFt] = useState(1800);
  const [accessNotes, setAccessNotes] = useState("");
  const [parking, setParking] = useState("");
  const [preferredTime, setPreferredTime] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] =
    useState<PropertyFormPayload["recurringFrequency"]>("monthly");
  const [loc, setLoc] = useState<LocationValue>({ lat: null, lng: null, address: "" });
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
    setAddressLine(editing?.addressLine ?? "");
    setLocality(editing?.locality ?? "");
    setCity(editing ? editing.city ?? "" : "Bengaluru");
    setStateName(editing?.state ?? "");
    setPostalCode(editing?.postalCode ?? "");
    setCountry(editing ? editing.country ?? "" : "India");
    setLocationNotes(editing?.locationNotes ?? "");
    setBedrooms(editing?.bedrooms ?? 3);
    setBathrooms(editing?.bathrooms ?? 2);
    setSqFt(editing?.carpetAreaSqFt ?? 1800);
    setAccessNotes(editing?.accessNotes ?? "");
    setParking(editing?.parkingInstructions ?? "");
    setPreferredTime(editing?.preferredTime ?? "");
    setRecurring(editing?.recurringService ?? false);
    setRecurringFrequency(editing?.recurringFrequency ?? "monthly");
    setLoc({ lat: editing?.lat ?? null, lng: editing?.lng ?? null, address: editing?.address ?? "" });
  }, [open, editing, defaultCustomerId, customers]);

  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: `${c.name} (${c.phone})`,
  }));

  // A chosen search result / pin lookup fills only the address parts that are still empty.
  const onLocation = (v: LocationValue) => {
    setLoc(v);
    if (v.address !== loc.address) setAddress(v.address);
    const f = v.found;
    if (f && f !== loc.found) {
      if (!addressLine.trim() && f.addressLine) setAddressLine(f.addressLine);
      if (!locality.trim() && f.locality) setLocality(f.locality);
      if ((!city.trim() || (!isEditing && city === "Bengaluru")) && f.city) setCity(f.city);
      if (!stateName.trim() && f.state) setStateName(f.state);
      if (!postalCode.trim() && f.postalCode) setPostalCode(f.postalCode);
      if (!country.trim() && f.country) setCountry(f.country);
    }
  };
  const halfPin = (loc.lat === null) !== (loc.lng === null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !address || !customerId) return;
    if (halfPin) return setError("The map location needs both latitude and longitude. Finish it or remove the pin.");
    setIsSubmitting(true);
    setError("");

    const result = await onSubmit({
      customerId,
      title,
      propertyType,
      address: address.trim(),
      addressLine: addressLine.trim(),
      locality: locality.trim(),
      city: city.trim(),
      state: stateName.trim(),
      postalCode: postalCode.trim(),
      country: country.trim(),
      bedrooms,
      bathrooms,
      carpetAreaSqFt: sqFt,
      accessNotes,
      parkingInstructions: parking,
      preferredTime,
      recurringService: recurring,
      recurringFrequency: recurring ? recurringFrequency : undefined,
      lat: loc.lat,
      lng: loc.lng,
      locationNotes: locationNotes.trim(),
      locationSource: loc.source,
      clearLocation: isEditing && typeof editing?.lat === "number" && loc.lat === null && loc.lng === null,
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-zinc-950">Location on the map <span className="font-normal text-zinc-500">(for navigation and the GPS start check)</span></legend>
            {open && <LocationPicker key={editing?.id ?? "new"} idPrefix="pf-loc" value={{ ...loc, address }} onChange={onLocation} height={220} showAddress={false} />}
          </fieldset>

          <Field label="Full address" required htmlFor="pf-address" hint="As the team should read it — flat, building, street, area">
            <textarea id="pf-address" value={address} onChange={(e) => setAddress(e.target.value)} rows={2} required autoComplete="street-address" className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" placeholder="Flat 402, Tower B, Sobha Dream Acres, Panathur Rd" />
          </Field>

          <Field label="Address line" htmlFor="pf-line" hint="Optional — flat / house number and street">
            <Input id="pf-line" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} autoComplete="address-line1" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Locality / area" htmlFor="pf-locality">
              <Input id="pf-locality" value={locality} onChange={(e) => setLocality(e.target.value)} placeholder="Bellandur" autoComplete="address-level3" />
            </Field>
            <Field label="City" htmlFor="pf-city">
              <Input id="pf-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
            </Field>
            <Field label="State" htmlFor="pf-state">
              <Input id="pf-state" value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="Karnataka" autoComplete="address-level1" />
            </Field>
            <Field label="Postal code" htmlFor="pf-pin">
              <Input id="pf-pin" inputMode="numeric" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="560102" autoComplete="postal-code" />
            </Field>
            <Field label="Country" htmlFor="pf-country">
              <Input id="pf-country" value={country} onChange={(e) => setCountry(e.target.value)} autoComplete="country-name" />
            </Field>
          </div>

          <Field label="Location notes" htmlFor="pf-locnotes" hint="Optional — landmark, which gate, how to find the building">
            <Input id="pf-locnotes" value={locationNotes} onChange={(e) => setLocationNotes(e.target.value)} placeholder="Opposite the Total Mall, gate 3" />
          </Field>

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
