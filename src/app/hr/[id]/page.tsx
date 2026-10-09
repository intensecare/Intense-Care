"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Phone, Mail, MapPin, ShieldCheck, Upload, Trash2, FileText, AlertTriangle } from "lucide-react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Notice, Skeleton, ErrorState } from "@/components/ui/states";
import { Pill, SelectField, callApi, inr, uploadFile, useApiList } from "@/components/biz/Bits";
import { EmployeeDialog } from "@/components/hr/EmployeeDialog";
import { PAY_TYPES, employmentLabel, type EmployeeRow } from "@/lib/business";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";

interface Detail {
  employee: EmployeeRow;
  assignments: { id: string; jobId: string; jobNumber: string; date: string; timeSlot: string; jobStatus: string; service: string; customer: string | null; role: string; status: string; rateType: string | null; rate: number | null }[];
  documents: { id: string; fileName: string; mimeType: string; category: string | null; label: string | null; expiresOn: string | null; createdAt: string; sizeBytes: number }[];
}

const DOC_TYPES = [["ID_PROOF", "ID proof"], ["AGREEMENT", "Agreement"], ["CERTIFICATE", "Certificate"], ["OTHER", "Other"]] as const;

/** Admin → HR → one staff member: profile, documents and the jobs they are on. */
export default function EmployeePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { data, error, reload } = useApiList<Detail>(() => `/api/hr/employees/${id}`, [id]);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [removeDoc, setRemoveDoc] = useState<Detail["documents"][number] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState("ID_PROOF");
  const [docLabel, setDocLabel] = useState("");
  const [docExpiry, setDocExpiry] = useState("");
  const [uploading, setUploading] = useState(false);
  const sensitive = can("hr.sensitive");

  if (error) return <AdminLayout><ErrorState message={error} onRetry={() => void reload()} /></AdminLayout>;
  if (!data) return <AdminLayout><div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-64" /></div></AdminLayout>;
  const e = data.employee;
  const expiring = data.documents.filter((d) => d.expiresOn && d.expiresOn <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));

  const handleDeleteEmployee = async () => {
    const res = await callApi<{ deleted?: boolean; retired?: boolean; message?: string }>(`/api/hr/employees/${e.id}`, { method: "DELETE" });
    setConfirmDelete(false);
    if (res.error) {
      setNotice({ tone: "error", text: res.error });
      return;
    }
    if (res.data?.retired) {
      setNotice({ tone: "info" as any, text: res.data.message || "Staff member deactivated." });
      void reload();
    } else {
      router.push("/hr");
    }
  };

  return (
    <AdminLayout>
      <Link href="/hr" className="inline-flex items-center gap-1 text-sm font-semibold text-zinc-600 hover:text-zinc-950 min-h-10"><ChevronLeft className="h-4 w-4" aria-hidden /> HR</Link>
      <div className="mt-2 mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950 break-words">{e.fullName}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600">
            <span className="font-mono">{e.employeeCode}</span>
            <Pill tone="info">{employmentLabel(e.employmentType)}</Pill>
            <Pill tone={e.status === "ACTIVE" ? "good" : e.status === "ON_LEAVE" ? "warn" : "neutral"}>{e.status === "ON_LEAVE" ? "On leave" : e.status === "EXITED" ? "Left" : e.status.charAt(0) + e.status.slice(1).toLowerCase()}</Pill>
            {e.employmentType === "FREELANCE" && <Pill tone={e.verificationStatus === "VERIFIED" ? "good" : "warn"}>{e.verificationStatus === "VERIFIED" ? "Verified" : `Verification ${e.verificationStatus.toLowerCase()}`}</Pill>}
          </div>
        </div>
        {can("hr.manage") && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" aria-hidden /> Edit</Button>
            <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" aria-hidden /> Delete</Button>
          </div>
        )}
      </div>
      {notice && <Notice tone={notice.tone} className="mb-4">{notice.text}</Notice>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-3">
            <h2 className="text-base font-semibold text-zinc-950">Contact</h2>
            <p className="flex items-center gap-2 text-sm"><Phone className="h-4 w-4 text-zinc-400" aria-hidden /> <a href={`tel:${e.phone}`} className="text-rose-600 font-medium">{e.phone}</a></p>
            {e.email && <p className="flex items-center gap-2 text-sm break-all"><Mail className="h-4 w-4 text-zinc-400" aria-hidden /> {e.email}</p>}
            {sensitive && e.address && <p className="flex items-start gap-2 text-sm"><MapPin className="h-4 w-4 text-zinc-400 mt-0.5 shrink-0" aria-hidden /> <span className="break-words">{e.address}</span></p>}
            {sensitive && e.emergencyContactName && <p className="text-sm text-zinc-700"><span className="font-semibold">Emergency:</span> {e.emergencyContactName}{e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ""}</p>}
          </section>
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-2 text-sm">
            <h2 className="text-base font-semibold text-zinc-950">Work</h2>
            <Row k="Designation" v={e.designation} /><Row k="Department" v={e.department} /><Row k="Manager" v={e.managerName} /><Row k="Joined" v={e.joiningDate ? formatDate(e.joiningDate) : null} />
            <Row k="Skills" v={e.skills.join(", ")} /><Row k="Service categories" v={e.serviceCategories.join(", ")} /><Row k="Availability" v={e.availabilityNotes} /><Row k="Preferred locations" v={e.preferredLocations} />
            {sensitive && e.payType && <Row k="Agreed pay" v={`${inr(e.payRate)} · ${PAY_TYPES.find((p) => p.key === e.payType)?.label ?? e.payType}`} />}
            {e.employmentType === "FREELANCE" && <Row k="Agreement" v={e.agreementOnFile ? "On file" : "Not on file"} />}
          </section>
        </div>

        <div className="xl:col-span-2 space-y-6">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-zinc-950">Jobs</h2>
            {data.assignments.length === 0 ? <p className="text-sm text-zinc-500">Not assigned to any job yet.</p> : (
              <DataTable caption="Assigned jobs" rows={data.assignments} rowKey={(a) => a.id} href={(a) => `/jobs/${a.jobId}`} columns={[
                { key: "j", header: "Job", mobile: "title", cell: (a) => <span className="font-mono font-semibold break-all">{a.jobNumber}</span> },
                { key: "s", header: "Service", mobile: "subtitle", cell: (a) => `${a.service}${a.customer ? ` · ${a.customer}` : ""}` },
                { key: "st", header: "Assignment", mobile: "badge", cell: (a) => <Pill tone={a.status === "COMPLETED" ? "good" : a.status === "DECLINED" || a.status === "REMOVED" ? "bad" : "info"}>{a.status.charAt(0) + a.status.slice(1).toLowerCase()}</Pill> },
                { key: "d", header: "When", cell: (a) => `${formatDate(a.date)} · ${a.timeSlot}` },
                { key: "r", header: "Role", cell: (a) => (a.role === "LEAD" ? "Team leader" : "Cleaner") },
                { key: "rate", header: "Rate", align: "right", cell: (a) => (a.rate != null ? `${inr(a.rate)}${a.rateType === "HOURLY" ? "/h" : ""}` : "—") },
              ]} />
            )}
          </section>

          {sensitive && (
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
              <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-zinc-400" aria-hidden /><h2 className="text-base font-semibold text-zinc-950">Documents</h2></div>
              {expiring.length > 0 && <Notice tone="info"><AlertTriangle className="inline h-4 w-4 mr-1" aria-hidden />{expiring.length} document{expiring.length === 1 ? " expires" : "s expire"} within 30 days.</Notice>}
              {data.documents.length === 0 ? <p className="text-sm text-zinc-500">No documents uploaded.</p> : (
                <ul className="divide-y divide-zinc-100">
                  {data.documents.map((d) => (
                    <li key={d.id} className="py-3 flex items-center gap-3">
                      <FileText className="h-5 w-5 text-zinc-400 shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <a href={`/api/files/${d.id}`} target="_blank" rel="noreferrer" className="block text-sm font-semibold text-rose-600 truncate">{d.label || d.fileName}</a>
                        <span className="block text-xs text-zinc-500">{DOC_TYPES.find((t) => t[0] === d.category)?.[1] ?? "Document"} · {formatDate(d.createdAt)}{d.expiresOn ? ` · expires ${formatDate(d.expiresOn)}` : ""}</span>
                      </div>
                      {can("hr.manage") && <Button size="sm" variant="ghost" aria-label={`Delete ${d.fileName}`} onClick={() => setRemoveDoc(d)}><Trash2 className="h-4 w-4 text-red-600" aria-hidden /></Button>}
                    </li>
                  ))}
                </ul>
              )}
              {can("hr.manage") && (
                <div className="rounded-xl border border-dashed border-zinc-300 p-4 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <SelectField label="Type" id="dc-type" value={docType} onChange={setDocType}>{DOC_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
                    <Field label="Label" htmlFor="dc-label"><Input id="dc-label" value={docLabel} onChange={(ev) => setDocLabel(ev.target.value)} maxLength={120} placeholder="e.g. Aadhaar" /></Field>
                    <Field label="Expires on" htmlFor="dc-exp"><Input id="dc-exp" type="date" value={docExpiry} onChange={(ev) => setDocExpiry(ev.target.value)} /></Field>
                  </div>
                  <Button variant="outline" loading={uploading} onClick={() => file.current?.click()}><Upload className="h-4 w-4" aria-hidden /> Upload document</Button>
                  <p className="text-xs text-zinc-500">JPEG, PNG, WebP or PDF · up to 3 MB. Only people allowed to see private HR details can open it.</p>
                  <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={async (ev) => {
                    const f = ev.target.files?.[0];
                    ev.target.value = "";
                    if (!f) return;
                    setUploading(true);
                    const r = await uploadFile(f, { ownerType: "employee", ownerId: e.id, category: docType, label: docLabel || undefined, expiresOn: docExpiry || undefined });
                    setUploading(false);
                    setNotice({ tone: r.error ? "error" : "success", text: r.error ?? "Document uploaded." });
                    if (!r.error) { setDocLabel(""); setDocExpiry(""); void reload(); }
                  }} />
                </div>
              )}
            </section>
          )}
        </div>
      </div>

      {editing && <EmployeeDialog employee={e} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setNotice({ tone: "success", text: "Saved." }); void reload(); }} />}
      <ConfirmModal isOpen={!!removeDoc} onClose={() => setRemoveDoc(null)} title="Delete this document?" description={`${removeDoc?.label || removeDoc?.fileName} will be removed permanently.`} confirmText="Delete" onConfirm={async () => { const d = removeDoc!; setRemoveDoc(null); const r = await callApi(`/api/files/${d.id}`, { method: "DELETE" }); setNotice({ tone: r.error ? "error" : "success", text: r.error ?? "Document deleted." }); if (!r.error) void reload(); }} />
      <ConfirmModal isOpen={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete or deactivate staff member?" description={`${e.fullName} (${e.employeeCode}) will be removed or deactivated if they have historical job assignments.`} confirmText="Delete / Deactivate" variant="destructive" onConfirm={handleDeleteEmployee} />
    </AdminLayout>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  if (!v) return null;
  return <div className="flex items-start justify-between gap-3"><span className="text-zinc-500 shrink-0">{k}</span><span className="text-right text-zinc-900 break-words min-w-0">{v}</span></div>;
}
