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

  const partnerOptions = [
    { value: "", label: "Direct / None" },
    ...partners.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
  ];

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Customer" : "Register Customer"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the customer profile, referral attribution, or account status."
              : "Add customer profile and configure referral attribution."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3 py-2 text-xs">
          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Customer Full Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="E.g. Siddharth Rao"
              required
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Phone (Notifications) *</label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98860 12345"
              required
              className="text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Email Address</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="siddharth@example.com"
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Primary Billing Address</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Bengaluru residence address..."
              className="text-xs"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Referral Partner Attribution</label>
            <SearchableSelect
              value={partnerId}
              onChange={setPartnerId}
              options={partnerOptions}
              placeholder="Direct / None"
            />
          </div>

          <div className="space-y-1">
            <label className="font-semibold text-slate-700">Customer Preferences / Notes</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="E.g. Prefers eco chemicals..."
              className="text-xs"
            />
          </div>

          {isEditing && (
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Account Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "active" | "inactive")}
                className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white text-xs"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}

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
                "Save Customer"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
