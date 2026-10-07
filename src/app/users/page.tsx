"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import { UserRole } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, ROLE_PERMISSIONS, ASSIGNABLE_ROLES, workspaceFor, type Role } from "@/lib/rbac";
import { onDutyWorkerIds } from "@/lib/staff-availability";
import {
  ShieldCheck,
  UserCheck,
  Smartphone,
  Users,
  Check,
  X,
  Edit2,
  Trash2,
  UserPlus,
  Power,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import {
  StaffDirectory,
  StaffDetailDialog,
  useStaffDirectory,
} from "@/components/common/StaffDirectory";

export default function UsersAndRolesPage() {
  const { users, jobs, customers, partners, addUser, updateUser, toggleUserStatus, deleteUser } = useApp();
  const { can } = useAuth();
  // Server-computed field-staff details — powers the ops_manager directory
  // and the click-to-reveal worker file in the admin table below.
  const directory = useStaffDirectory();
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);

  // Duty state for staff rows: a worker on any non-terminal job shows "On duty"
  // everywhere (same helper as dispatcher / booking form / crew picker). Jobs
  // arriving from the store's 10s live-sync keep this badge current; the job
  // completing auto-frees the worker.
  const onDutyIds = onDutyWorkerIds(jobs);

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState<{ id: string; name: string } | null>(null);

  // Form State
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("field_staff");
  const [userTeamId, setUserTeamId] = useState("");
  const [userCustomerId, setUserCustomerId] = useState("");
  const [userPartnerId, setUserPartnerId] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Role reference cards are generated from the central matrix so this page
  // can never drift from what the server enforces.
  const ROLE_ICON: Record<Role, React.ElementType> = {
    super_admin: ShieldCheck,
    ops_manager: UserCheck,
    scheduler: UserCheck,
    field_manager: Smartphone,
    field_staff: Smartphone,
    qc_inspector: ShieldCheck,
    accounts: Users,
    referral_partner: Users,
    customer: Users,
  };
  const ROLE_BADGE: Record<Role, string> = {
    super_admin: "bg-slate-900 text-white",
    ops_manager: "bg-blue-600 text-white",
    scheduler: "bg-sky-600 text-white",
    field_manager: "bg-emerald-600 text-white",
    field_staff: "bg-emerald-500 text-white",
    qc_inspector: "bg-violet-600 text-white",
    accounts: "bg-amber-600 text-white",
    referral_partner: "bg-pink-600 text-white",
    customer: "bg-slate-500 text-white",
  };
  const ROLE_DEFINITIONS = ROLES.map((role) => {
    const grants = Object.entries(ROLE_PERMISSIONS[role]).filter(([, scope]) => scope !== "NONE");
    const modules = Array.from(new Set(grants.map(([p]) => p.split(".")[0])));
    const scopeSummary = Array.from(new Set(grants.map(([, scope]) => scope))).join(" / ");
    return {
      role,
      title: ROLE_LABELS[role],
      description: ROLE_DESCRIPTIONS[role],
      icon: ROLE_ICON[role],
      badgeColor: ROLE_BADGE[role],
      home: workspaceFor(role).title,
      permissions: [
        `Workspace: ${workspaceFor(role).title} (${workspaceFor(role).home})`,
        `Record scope: ${scopeSummary || "none"}`,
        `${grants.length} permissions across ${modules.length} modules: ${modules.join(", ")}`,
      ],
    };
  });

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !userEmail.trim() || userPassword.length < 8) return;

    setFormBusy(true);
    setFormError(null);
    const res = await addUser({
      name: userName,
      email: userEmail,
      phone: userPhone,
      role: userRole,
      password: userPassword,
      teamId: userTeamId || null,
      customerId: userRole === "customer" ? userCustomerId || null : null,
      referralPartnerId: userRole === "referral_partner" ? userPartnerId || null : null,
    });
    setFormBusy(false);

    if (res.success) {
      setIsAddUserOpen(false);
      setUserName("");
      setUserEmail("");
      setUserPhone("");
      setUserPassword("");
      setUserRole("field_staff");
      setUserTeamId("");
      setUserCustomerId("");
      setUserPartnerId("");
    } else {
      setFormError(res.message);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserId) return;

    setFormBusy(true);
    setFormError(null);
    const res = await updateUser(editingUserId, {
      name: userName,
      phone: userPhone,
      role: userRole,
      teamId: userTeamId || null,
      customerId: userRole === "customer" ? userCustomerId || null : null,
      referralPartnerId: userRole === "referral_partner" ? userPartnerId || null : null,
      ...(userPassword ? { password: userPassword } : {}),
    });
    setFormBusy(false);

    if (res.success) {
      setEditingUserId(null);
      setUserPassword("");
    } else {
      setFormError(res.message);
    }
  };

  const openEditModal = (u: any) => {
    setEditingUserId(u.id);
    setUserName(u.name);
    setUserEmail(u.email);
    setUserPhone(u.phone);
    setUserRole(u.role);
    setUserTeamId(u.teamId || "");
    setUserCustomerId(u.customerId || "");
    setUserPartnerId(u.referralPartnerId || "");
  };

  // ops_manager lands here from the sidebar's "Staff Directory" link and gets
  // the read-only roster with click-to-reveal worker files. Account CRUD below
  // stays super_admin-only.
  if (!can("users.manage")) {
    return (
      <AdminLayout>
        <PageHeader
          title="Field Staff Directory"
          description="Every field worker's contact details, live workload and quality record — click a name to open their full file."
          breadcrumbs={[
            { label: "Operations", href: "/" },
            { label: "Staff Directory" },
          ]}
        />
        <StaffDirectory
          entries={directory.entries}
          loading={directory.loading}
          error={directory.error}
          onRetry={directory.refresh}
        />
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <PageHeader
        title="User & Staff Account Directory"
        description="Manage system access: create staff accounts, assign roles, reset passwords, and activate or disable sign-in."
        breadcrumbs={[
          { label: "Administration", href: "/" },
          { label: "Users & Roles" },
        ]}
        actions={
          can("users.manage") && (
            <Button
              onClick={() => {
                setUserName("");
                setUserEmail("");
                setUserPhone("");
                setUserRole("field_staff");
                setIsAddUserOpen(true);
              }}
              size="sm"
              className="h-9 gap-1.5 bg-rose-500 text-white font-medium text-xs"
            >
              <UserPlus className="h-4 w-4" />
              Add System User / Staff
            </Button>
          )
        }
      />

      <div className="space-y-6">
        {/* System User Accounts Table */}
        <div className="bg-white rounded-lg border border-slate-200/90 shadow-xs overflow-hidden space-y-3 p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-xs font-semibold text-slate-900">
                Active Staff & User Accounts ({users.length})
              </h3>
              <p className="text-xs text-slate-500">
                Registered accounts across the nine platform roles. Every permission is resolved from the central RBAC matrix.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold text-[10px]">
                  <th className="py-2.5 px-3">Staff / User</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Contact</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Duty</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const roleDef = ROLE_DEFINITIONS.find((r) => r.role === u.role);
                  const Icon = roleDef?.icon || Users;

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <div className="h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-semibold text-xs shrink-0">
                            {u.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            {ASSIGNABLE_ROLES.includes(u.role) ? (
                              <button
                                type="button"
                                onClick={() => setDetailWorkerId(u.id)}
                                title="Open this worker's full details"
                                className="font-semibold text-slate-900 hover:text-indigo-700 hover:underline"
                              >
                                {u.name}
                              </button>
                            ) : (
                              <div className="font-semibold text-slate-900">{u.name}</div>
                            )}
                            <div className="text-[11px] text-slate-500">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold ${ROLE_BADGE[u.role] ?? "bg-slate-500 text-white"}`}
                        >
                          <Icon className="h-3 w-3" />
                          {roleDef?.title || u.role}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-slate-700 font-mono">
                        {u.phone || "—"}
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                            u.active
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-500 border border-slate-200"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              u.active ? "bg-emerald-500" : "bg-slate-400"
                            }`}
                          />
                          {u.active ? "Active" : "Disabled"}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        {ASSIGNABLE_ROLES.includes(u.role) ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                              onDutyIds.has(u.id)
                                ? "bg-amber-50 text-amber-700 border border-amber-200"
                                : "bg-slate-50 text-slate-500 border border-slate-200"
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                onDutyIds.has(u.id) ? "bg-amber-500" : "bg-emerald-500"
                              }`}
                            />
                            {onDutyIds.has(u.id) ? "On duty" : "Available"}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-300">—</span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {can("users.manage") && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEditModal(u)}
                                className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => toggleUserStatus(u.id)}
                                className="h-7 w-7 p-0 text-slate-500 hover:text-amber-600"
                                title="Toggle active status"
                              >
                                <Power className="h-3.5 w-3.5" />
                              </Button>

                              {users.length > 1 && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeleteTargetUser({ id: u.id, name: u.name })}
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Role Matrix Reference */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {ROLE_DEFINITIONS.map((def) => {
            const Icon = def.icon;
            return (
              <div
                key={def.role}
                className="bg-white rounded-lg border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${def.badgeColor}`}>
                      {def.title}
                    </span>
                    <Icon className="h-5 w-5 text-slate-400" />
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">{def.description}</p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-semibold text-slate-400">
                      Key Capabilities:
                    </span>
                    <ul className="space-y-1 text-xs text-slate-700">
                      {def.permissions.map((p, idx) => (
                        <li key={idx} className="flex items-start gap-1.5 text-[11px]">
                          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Modal: Add User */}
      {isAddUserOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Add Staff / User Account</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsAddUserOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              {formError && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{formError}</p>
              )}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Full Name</label>
                <Input
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Email Address</label>
                <Input
                  type="email"
                  value={userEmail}
                  onChange={(e) => setUserEmail(e.target.value)}
                  placeholder="e.g. rahul@intensecare.com"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Phone Number</label>
                <Input
                  value={userPhone}
                  onChange={(e) => setUserPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">
                  Initial Password (min 8 characters)
                </label>
                <Input
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  minLength={8}
                  required
                  className="font-mono"
                />
                <p className="text-[10px] text-slate-400">
                  Stored as a bcrypt hash; the user changes it by contacting an admin.
                </p>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Role</label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value as UserRole)}
                  className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">{ROLE_DESCRIPTIONS[userRole]}</p>
              </div>

              {ASSIGNABLE_ROLES.includes(userRole) && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Team (optional)</label>
                  <Input value={userTeamId} onChange={(e) => setUserTeamId(e.target.value)} placeholder="e.g. team-a" />
                  <p className="text-[10px] text-slate-400">Used for TEAM-scoped visibility.</p>
                </div>
              )}
              {userRole === "customer" && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Customer record</label>
                  <select
                    value={userCustomerId}
                    onChange={(e) => setUserCustomerId(e.target.value)}
                    required
                    className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                  >
                    <option value="">Select the customer this login belongs to…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.phone}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400">The portal shows only this customer&apos;s services. AMC / NRI features follow the customer&apos;s contracts.</p>
                </div>
              )}
              {userRole === "referral_partner" && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Referral partner</label>
                  <select
                    value={userPartnerId}
                    onChange={(e) => setUserPartnerId(e.target.value)}
                    required
                    className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                  >
                    <option value="">Select the partner this login belongs to…</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAddUserOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={formBusy} className="">
                  {formBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Add User Account
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit User */}
      {editingUserId && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Edit User Details</h3>
              <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-3 text-xs">
              {formError && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">{formError}</p>
              )}
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Full Name</label>
                <Input value={userName} onChange={(e) => setUserName(e.target.value)} required />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Phone Number</label>
                <Input value={userPhone} onChange={(e) => setUserPhone(e.target.value)} />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Reset Password (optional)</label>
                <Input
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  minLength={8}
                  placeholder="Leave blank to keep current password"
                  className="font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Role</label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value as UserRole)}
                  className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">{ROLE_DESCRIPTIONS[userRole]}</p>
              </div>

              {ASSIGNABLE_ROLES.includes(userRole) && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Team (optional)</label>
                  <Input value={userTeamId} onChange={(e) => setUserTeamId(e.target.value)} placeholder="e.g. team-a" />
                  <p className="text-[10px] text-slate-400">Used for TEAM-scoped visibility.</p>
                </div>
              )}
              {userRole === "customer" && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Customer record</label>
                  <select
                    value={userCustomerId}
                    onChange={(e) => setUserCustomerId(e.target.value)}
                    required
                    className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                  >
                    <option value="">Select the customer this login belongs to…</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.phone}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400">The portal shows only this customer&apos;s services. AMC / NRI features follow the customer&apos;s contracts.</p>
                </div>
              )}
              {userRole === "referral_partner" && (
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700">Referral partner</label>
                  <select
                    value={userPartnerId}
                    onChange={(e) => setUserPartnerId(e.target.value)}
                    required
                    className="w-full h-9 rounded-md border border-slate-200 px-3 text-xs"
                  >
                    <option value="">Select the partner this login belongs to…</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.code}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingUserId(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={formBusy} className="">
                  {formBusy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* User Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(deleteTargetUser)}
        onClose={() => setDeleteTargetUser(null)}
        onConfirm={async () => {
          if (deleteTargetUser) {
            const result = await deleteUser(deleteTargetUser.id);
            if (!result.success) setFormError(result.message);
          }
        }}
        title="Delete User Account"
        description={`Are you sure you want to delete user account for "${deleteTargetUser?.name}"? Access permissions for this account will be revoked.`}
        confirmText="Delete Account"
        cancelText="Cancel"
        variant="destructive"
      />

      {/* Click-to-reveal worker file (staff rows in the accounts table) */}
      <StaffDetailDialog
        entry={
          (directory.entries || []).find((e) => e.id === detailWorkerId) || null
        }
        onClose={() => setDetailWorkerId(null)}
      />
    </AdminLayout>
  );
}
