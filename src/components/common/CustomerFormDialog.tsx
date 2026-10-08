"use client";

import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Customer, ReferralPartner } from "@/lib/types";

export interface CustomerFormPayload {
  name: string;
  phone: string;
  email: string;
  whatsapp: string;
  address: string;
  source: string;
  referralPartnerId: string | null;
  notes: string;
  status: "active" | "inactive";
}

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: ReferralPartner[];
  /** Customer being edited, or null/undefined for create mode. */
  editing?: Customer | null;
  onSubmit: (
    payload: CustomerFormPayload
  ) => Promise<{ success: boolean; message: string }>;
}

/**
 * Shared create/edit customer form used by the Customers directory and the
 * customer detail page, so both flows stay in lockstep with the API contract.
 */
export function CustomerFormDialog({
  open,
  onOpenChange,
  partners,
  editing,
  onSubmit,
}: CustomerFormDialogProps) {
  const isEditing = !!editing;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  // Source / referral attribution are kept as-is (no longer edited in the UI).
  const [source, setSource] = useState("direct");
  const [partnerId, setPartnerId] = useState("");
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Re-seed the form whenever the dialog opens (create or edit target).
  useEffect(() => {
    if (!open) return;
    setError("");
    setName(editing?.name ?? "");
    setPhone(editing?.phone ?? "");
    setEmail(editing?.email ?? "");
    setAddress(editing?.address ?? "");
    setSource(editing?.source || "direct");
    setPartnerId(editing?.referralPartnerId || "");
    setNotes(editing?.notes ?? "");
    setStatus(editing?.status === "inactive" ? "inactive" : "active");
  }, [open, editing]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;
    setIsSubmitting(true);
    setError("");

    const result = await onSubmit({
      name,
      phone,
      email,
      whatsapp: phone,
      address,
      source,
      referralPartnerId: partnerId || null,
      notes,
      status,
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
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit customer" : "Add customer"}</DialogTitle>
            <DialogDescription>Contact details used for job updates and the customer link.</DialogDescription>
          </DialogHeader>
          {error && <div role="alert" className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800">{error}</div>}
          <Field label="Full name" required htmlFor="cf-name">
            <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Shetty" required minLength={2} autoComplete="name" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Phone" required hint="Used for WhatsApp / SMS updates" htmlFor="cf-phone">
              <Input id="cf-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98450 12345" required minLength={7} autoComplete="tel" />
            </Field>
            <Field label="Email" htmlFor="cf-email">
              <Input id="cf-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />
            </Field>
          </div>
          <Field label="Address" htmlFor="cf-address">
            <Input id="cf-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, area, city" autoComplete="street-address" />
          </Field>
          <Field label="Notes" hint="Preferences, access instructions…" htmlFor="cf-notes">
            <textarea id="cf-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm" />
          </Field>
          {isEditing && (
            <label className="flex items-center gap-3 rounded-xl border border-zinc-200 px-4 h-12 text-sm">
              <input type="checkbox" checked={status === "active"} onChange={(e) => setStatus(e.target.checked ? "active" : "inactive")} className="h-5 w-5 accent-rose-500" />
              Active customer
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={isSubmitting} disabled={!name.trim() || !phone.trim()}>{isSubmitting ? "Saving…" : isEditing ? "Save changes" : "Add customer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
