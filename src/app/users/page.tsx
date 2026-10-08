"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, SIGN_IN_ROLES, normalizeRole, type Role } from "@/lib/rbac";
import type { User } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { UserPlus, Pencil, Trash2, ShieldCheck, Smartphone, ClipboardCheck, Loader2, Receipt } from "lucide-react";

const ROLE_ICON: Record<Role, React.ElementType> = {
  admin: ShieldCheck,
  field_manager: Smartphone,
  qc_inspector: ClipboardCheck,
  tax_officer: Receipt,
  customer: ShieldCheck,
};

const ROLE_TONE: Record<Role, string> = {
  admin: "bg-zinc-900 text-white",
  field_manager: "bg-emerald-50 text-emerald-800 border border-emerald-200",
  qc_inspector: "bg-rose-50 text-rose-700 border border-rose-200",
  tax_officer: "bg-info-50 text-info-700 border border-info-200",
  customer: "bg-zinc-100 text-zinc-600",
};

interface FormState {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  role: Role;
  password: string;
}

const EMPTY: FormState = { id: null, name: "", email: "", phone: "", role: "field_manager", password: "" };

/**
 * Users — the three sign-in roles only (Admin, Field Manager, QC).
 * Customers never get an account: they use the secure service link.
 */
export default function UsersPage() {
  const { users, addUser, updateUser, toggleUserStatus, deleteUser } = useApp();
  const { currentUser } = useAuth();
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);

  const staff = users.filter((u) => SIGN_IN_ROLES.includes(normalizeRole(u.role)));
  const groups = SIGN_IN_ROLES.map((role) => ({ role, members: staff.filter((u) => normalizeRole(u.role) === role) }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setError(null);
    const res = form.id
      ? await updateUser(form.id, { name: form.name, phone: form.phone, role: form.role, ...(form.password ? { password: form.password } : {}) })
      : await addUser({ name: form.name, email: form.email, phone: form.phone, role: form.role, password: form.password });
    setBusy(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    setForm(null);
    setNotice(res.message);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Users"
        description="Admins run the business, Field Managers do the work, QC checks it. Customers don't need an account."
        actions={
          <Button className="h-11 px-5 gap-2 rounded-xl text-sm text-white" onClick={() => { setError(null); setForm({ ...EMPTY }); }}>
            <UserPlus className="h-4 w-4" /> Add User
          </Button>
        }
      />

      {notice && <div className="mb-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">{notice}</div>}

      <div className="space-y-6">
        {groups.map(({ role, members }) => {
          const Icon = ROLE_ICON[role];
          return (
            <section key={role} className="rounded-2xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100 flex items-start gap-3">
                <span className="h-10 w-10 rounded-xl bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0">
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-zinc-900">
                    {ROLE_LABELS[role]} <span className="text-zinc-400 font-normal">· {members.length}</span>
                  </h2>
                  <p className="text-sm text-zinc-500">{ROLE_DESCRIPTIONS[role]}</p>
                </div>
              </div>
              {members.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-zinc-500">No {ROLE_LABELS[role]} accounts yet.</div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {members.map((u) => (
                    <li key={u.id} className="px-5 py-4 flex flex-wrap items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-rose-500 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                        {u.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-[10rem]">
                        <div className="text-sm font-semibold text-zinc-900 flex items-center gap-2">
                          {u.name}
                          {!u.active && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-zinc-100 text-zinc-500">Disabled</span>}
                        </div>
                        <div className="text-xs text-zinc-500 break-all">{u.email} · {u.phone || "no phone"}</div>
                      </div>
                      <span className={cn("px-2.5 py-1 rounded-lg text-xs font-semibold", ROLE_TONE[normalizeRole(u.role)])}>{ROLE_LABELS[normalizeRole(u.role)]}</span>
                      {u.id !== currentUser?.id && (
                        <div className="flex items-center gap-1.5">
                          <Button variant="outline" size="sm" className="" onClick={() => void toggleUserStatus(u.id)}>
                            {u.active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-9 p-0"
                            title="Edit"
                            onClick={() => { setError(null); setForm({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: normalizeRole(u.role), password: "" }); }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="outline" size="sm" className="w-9 p-0 text-red-600" title="Delete" onClick={() => setDeleteTarget(u)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="sm:rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit user" : "Add user"}</DialogTitle>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-zinc-700">Role</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SIGN_IN_ROLES.map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setForm({ ...form, role: r })}
                      className={cn("h-12 rounded-xl border text-sm font-semibold transition-colors", form.role === r ? "border-rose-500 bg-rose-50 text-rose-700" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50")}
                    >
                      {ROLE_LABELS[r]}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500">{ROLE_DESCRIPTIONS[form.role]}</p>
              </div>
              <Field label="Full name">
                <Input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-11 rounded-xl" />
              </Field>
              <Field label="Email (sign-in)">
                <Input required type="email" disabled={!!form.id} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11 rounded-xl" />
              </Field>
              <Field label="Phone (for job notifications)">
                <Input required minLength={5} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="h-11 rounded-xl" />
              </Field>
              <Field label={form.id ? "New password (leave empty to keep)" : "Password (8+ characters)"}>
                <Input type="password" required={!form.id} minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-11 rounded-xl" />
              </Field>
              {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}
              <Button type="submit" disabled={busy} className="w-full h-12 rounded-xl text-sm text-white">
                {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {form.id ? "Save changes" : "Create user"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete user?"
        description={deleteTarget ? `${deleteTarget.name} will no longer be able to sign in. Users with job history are disabled instead of deleted.` : ""}
        confirmText="Delete"
        variant="destructive"
        onConfirm={async () => {
          if (!deleteTarget) return;
          const res = await deleteUser(deleteTarget.id);
          setDeleteTarget(null);
          setNotice(res.message);
        }}
      />
    </AdminLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-zinc-700">{label}</label>
      {children}
    </div>
  );
}
