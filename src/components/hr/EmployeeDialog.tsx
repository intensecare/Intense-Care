"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice } from "@/components/ui/states";
import { SelectField, callApi, textareaCls } from "@/components/biz/Bits";
import { EMPLOYMENT_TYPES, PAY_TYPES, type EmployeeRow } from "@/lib/business";
import { useApp } from "@/lib/app-context";
import { toLocalDateString } from "@/lib/utils";

const csv = (s: string) => Array.from(new Set(s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)));

/** Add or edit a staff member. Compensation and personal details appear only when the server sent them (hr.sensitive). */
export function EmployeeDialog({ employee, defaultType = "PERMANENT", onClose, onSaved }: { employee?: EmployeeRow | null; defaultType?: string; onClose: () => void; onSaved: (e: EmployeeRow) => void }) {
  const { users } = useApp();
  const sensitive = employee ? "payType" in employee : true;
  const [v, setV] = useState(() => ({
    fullName: employee?.fullName ?? "",
    phone: employee?.phone ?? "",
    email: employee?.email ?? "",
    address: employee?.address ?? "",
    emergencyContactName: employee?.emergencyContactName ?? "",
    emergencyContactPhone: employee?.emergencyContactPhone ?? "",
    employmentType: employee?.employmentType ?? defaultType,
    department: employee?.department ?? "",
    designation: employee?.designation ?? "",
    joiningDate: employee?.joiningDate ?? toLocalDateString(),
    status: employee?.status ?? "ACTIVE",
    managerUserId: employee?.managerUserId ?? "",
    userId: employee?.userId ?? "",
    skills: (employee?.skills ?? []).join(", "),
    serviceCategories: (employee?.serviceCategories ?? []).join(", "),
    availabilityNotes: employee?.availabilityNotes ?? "",
    preferredLocations: employee?.preferredLocations ?? "",
    payType: employee?.payType ?? "",
    payRate: employee?.payRate != null ? String(employee.payRate) : "",
    verificationStatus: employee?.verificationStatus ?? "PENDING",
    agreementOnFile: employee?.agreementOnFile ?? false,
    notes: employee?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const up = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  const freelance = v.employmentType === "FREELANCE";
  const managers = users.filter((u) => (u.role === "field_manager" || u.role === "admin") && u.active !== false);
  useEffect(() => {
    // A freelancer is paid per hour or per job; switching type clears an invalid pay type.
    if (freelance && (v.payType === "MONTHLY" || v.payType === "DAILY")) up({ payType: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freelance]);

  const save = async () => {
    setError(null);
    if (v.fullName.trim().length < 2) return setError("Enter the full name.");
    if (v.phone.trim().length < 7) return setError("Enter a phone number.");
    const rate = v.payRate === "" ? null : Number(v.payRate);
    if (v.payType && (rate === null || !(rate >= 0))) return setError("Enter the agreed rate.");
    setBusy(true);
    const body: Record<string, unknown> = {
      fullName: v.fullName, phone: v.phone, email: v.email || null, employmentType: v.employmentType, department: v.department || null, designation: v.designation || null,
      joiningDate: v.joiningDate || null, status: v.status, managerUserId: v.managerUserId || null, userId: v.userId || null,
      skills: csv(v.skills), serviceCategories: csv(v.serviceCategories), availabilityNotes: v.availabilityNotes || null, preferredLocations: v.preferredLocations || null,
      verificationStatus: v.verificationStatus, agreementOnFile: v.agreementOnFile, notes: v.notes || null,
      ...(sensitive ? { address: v.address || null, emergencyContactName: v.emergencyContactName || null, emergencyContactPhone: v.emergencyContactPhone || null, payType: v.payType || null, payRate: v.payType ? rate : null } : {}),
    };
    const r = await callApi<EmployeeRow>(employee ? `/api/hr/employees/${employee.id}` : "/api/hr/employees", { method: employee ? "PATCH" : "POST", json: body });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error ?? "Couldn't save.");
    onSaved(r.data);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{employee ? `Edit ${employee.fullName}` : freelance ? "Add freelancer" : "Add staff member"}</DialogTitle>
          <DialogDescription>Only what the business needs. Cleaning staff don&apos;t need a login.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full name" htmlFor="em-name" required><Input id="em-name" value={v.fullName} onChange={(e) => up({ fullName: e.target.value })} maxLength={160} /></Field>
            <Field label="Phone" htmlFor="em-phone" required><Input id="em-phone" type="tel" inputMode="tel" value={v.phone} onChange={(e) => up({ phone: e.target.value })} maxLength={20} /></Field>
            <SelectField label="Employment type" id="em-type" value={v.employmentType} onChange={(t) => up({ employmentType: t })} hint={employee ? "Can't change once they have job assignments." : undefined}>{EMPLOYMENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</SelectField>
            <SelectField label="Status" id="em-status" value={v.status} onChange={(s) => up({ status: s })}><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="INACTIVE">Inactive</option><option value="EXITED">Left the company</option></SelectField>
            <Field label="Email" htmlFor="em-email"><Input id="em-email" type="email" inputMode="email" value={v.email} onChange={(e) => up({ email: e.target.value })} /></Field>
            <Field label="Joining date" htmlFor="em-join"><Input id="em-join" type="date" value={v.joiningDate} onChange={(e) => up({ joiningDate: e.target.value })} /></Field>
            <Field label="Department or team" htmlFor="em-dept"><Input id="em-dept" value={v.department} onChange={(e) => up({ department: e.target.value })} maxLength={80} placeholder="e.g. Deep cleaning" /></Field>
            <Field label="Designation" htmlFor="em-desig"><Input id="em-desig" value={v.designation} onChange={(e) => up({ designation: e.target.value })} maxLength={80} placeholder="e.g. Cleaner, Team lead" /></Field>
            <SelectField label="Assigned manager" id="em-mgr" value={v.managerUserId} onChange={(m) => up({ managerUserId: m })}><option value="">None</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</SelectField>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-semibold text-zinc-950">Skills and availability</legend>
            <Field label="Skills and specializations" htmlFor="em-skills" hint="Separate with commas — e.g. sofa shampoo, kitchen degreasing, glass"><Input id="em-skills" value={v.skills} onChange={(e) => up({ skills: e.target.value })} /></Field>
            <Field label="Service categories" htmlFor="em-cats" hint="e.g. residential, commercial"><Input id="em-cats" value={v.serviceCategories} onChange={(e) => up({ serviceCategories: e.target.value })} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Availability" htmlFor="em-avail"><Input id="em-avail" value={v.availabilityNotes} onChange={(e) => up({ availabilityNotes: e.target.value })} maxLength={500} placeholder="e.g. Weekdays, not Sundays" /></Field>
              <Field label="Preferred work locations" htmlFor="em-loc"><Input id="em-loc" value={v.preferredLocations} onChange={(e) => up({ preferredLocations: e.target.value })} maxLength={300} /></Field>
            </div>
          </fieldset>

          {freelance && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-semibold text-zinc-950">Freelancer verification</legend>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <SelectField label="Verification status" id="em-ver" value={v.verificationStatus} onChange={(s) => up({ verificationStatus: s })} hint="Only verified freelancers can be assigned to jobs."><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option></SelectField>
                <label className="flex items-center gap-3 min-h-11 sm:pt-6 text-sm font-medium text-zinc-800"><input type="checkbox" checked={v.agreementOnFile} onChange={(e) => up({ agreementOnFile: e.target.checked })} className="h-5 w-5 accent-rose-500" /> Agreement is on file</label>
              </div>
            </fieldset>
          )}

          {sensitive && (
            <fieldset className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
              <legend className="px-1 text-sm font-semibold text-zinc-950">Private details — visible to authorized users only</legend>
              <Field label="Address" htmlFor="em-addr"><textarea id="em-addr" rows={2} value={v.address} onChange={(e) => up({ address: e.target.value })} className={textareaCls} maxLength={400} /></Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Emergency contact" htmlFor="em-ecn"><Input id="em-ecn" value={v.emergencyContactName} onChange={(e) => up({ emergencyContactName: e.target.value })} maxLength={120} /></Field>
                <Field label="Emergency phone" htmlFor="em-ecp"><Input id="em-ecp" type="tel" value={v.emergencyContactPhone} onChange={(e) => up({ emergencyContactPhone: e.target.value })} maxLength={20} /></Field>
                <SelectField label={freelance ? "Agreed payment type" : "Pay type"} id="em-pt" value={v.payType} onChange={(p) => up({ payType: p })}><option value="">Not set</option>{PAY_TYPES.filter((p) => !freelance || p.key === "HOURLY" || p.key === "PER_JOB").map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</SelectField>
                <Field label={freelance ? "Agreed rate (₹)" : "Pay rate (₹)"} htmlFor="em-rate"><Input id="em-rate" inputMode="decimal" value={v.payRate} onChange={(e) => up({ payRate: e.target.value })} disabled={!v.payType} /></Field>
              </div>
              <Field label="Internal notes" htmlFor="em-notes"><textarea id="em-notes" rows={2} value={v.notes} onChange={(e) => up({ notes: e.target.value })} className={textareaCls} maxLength={1000} /></Field>
            </fieldset>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void save()}>{employee ? "Save changes" : "Add"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
