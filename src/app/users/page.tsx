"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { useApp } from "@/lib/app-context";
import { UserRole } from "@/lib/types";
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
  const { currentRole, users, addUser, updateUser, toggleUserStatus, deleteUser } = useApp();
  // Server-computed field-staff details — powers the ops_manager directory
  // and the click-to-reveal worker file in the admin table below.
  const directory = useStaffDirectory();
  const [detailWorkerId, setDetailWorkerId] = useState<string | null>(null);

  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [deleteTargetUser, setDeleteTargetUser] = useState<{ id: string; name: string } | null>(null);

  // Form State
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [userRole, setUserRole] = useState<UserRole>("staff");
  const [userPassword, setUserPassword] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const ROLE_DEFINITIONS: {
    role: UserRole;
    title: string;
    description: string;
    icon: React.ElementType;
    badgeColor: string;
    permissions: string[];
  }[] = [
    {
      role: "super_admin",
      title: "Super Admin",
      description: "Full platform control: user management, customers, properties, job scheduling, finance, expenses, revenue analytics, settings, audit logs.",
      icon: ShieldCheck,
      badgeColor: "bg-slate-900 text-white",
      permissions: [
        "Create, edit & delete jobs",
        "Manage customers & properties",
        "Override state machine transitions",
        "Manage platform settings & OTP policies",
        "Manage finance (Quotes, Invoices, Payments, Expenses)",
        "View immutable audit logs",
        "Manage user permissions & credentials",
      ],
    },
    {
      role: "ops_manager",
      title: "Operations Manager (Ops & QA)",
      description: "Next-day job dispatch queue (8 PM default), direct field-worker assignment, live execution monitoring, QA inspections (PASS/REWORK), and reinspections.",
      icon: UserCheck,
      badgeColor: "bg-blue-600 text-white",
      permissions: [
        "View next-day dispatch queue (from configured dispatch time)",
        "Assign field staff to scheduled jobs",
        "Monitor live job progress & field-worker status",
        "Perform room-by-room quality inspections & score audits",
        "Issue rework tasks & conduct final reinspections",
        "Handle customer attention tickets",
      ],
    },
    {
      role: "staff",
      title: "Staff / Field Worker",
      description: "Field execution role: view assigned jobs, property navigation, customer OTP verification gate, checklists, before/after evidence photos, rework execution.",
      icon: Smartphone,
      badgeColor: "bg-emerald-600 text-white",
      permissions: [
        "View assigned jobs only",
        "Record property arrival",
        "Verify customer arrival OTP",
        "Execute room-wise cleaning checklists & upload photo evidence",
        "Mark work completed for QA review",
        "Execute assigned rework tasks",
      ],
    },
  ];

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !userEmail.trim() || userPassword.length < 6) return;

    setFormBusy(true);
    setFormError(null);
    const res = await addUser({
      name: userName,
      email: userEmail,
      phone: userPhone,
      role: userRole,
      password: userPassword,
    });
    setFormBusy(false);

    if (res.success) {
      setIsAddUserOpen(false);
      setUserName("");
      setUserEmail("");
      setUserPhone("");
      setUserPassword("");
      setUserRole("staff");
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
  };

  // ops_manager lands here from the sidebar's "Staff Directory" link and gets
  // the read-only roster with click-to-reveal worker files. Account CRUD below
  // stays super_admin-only.
  if (currentRole === "ops_manager") {
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
          currentRole === "super_admin" && (
            <Button
              onClick={() => {
                setUserName("");
                setUserEmail("");
                setUserPhone("");
                setUserRole("staff");
                setIsAddUserOpen(true);
              }}
              size="sm"
              className="h-9 gap-1.5 bg-slate-900 text-white font-medium text-xs"
            >
              <UserPlus className="h-4 w-4" />
              Add System User / Staff
            </Button>
          )
        }
      />

      <div className="space-y-6">
        {/* System User Accounts Table */}
        <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden space-y-3 p-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Active Staff & User Accounts ({users.length})
              </h3>
              <p className="text-xs text-slate-500">
                Registered platform credentials across Super Admin, Operations Manager, and Field Staff roles.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold uppercase text-[10px]">
                  <th className="py-2.5 px-3">Staff / User</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Contact</th>
                  <th className="py-2.5 px-3">Status</th>
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
                          <div className="h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-xs shrink-0">
                            {u.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            {u.role === "staff" ? (
                              <button
                                type="button"
                                onClick={() => setDetailWorkerId(u.id)}
                                title="Open this worker's full details"
                                className="font-bold text-slate-900 hover:text-indigo-700 hover:underline"
                              >
                                {u.name}
                              </button>
                            ) : (
                              <div className="font-bold text-slate-900">{u.name}</div>
                            )}
                            <div className="text-[11px] text-slate-500">{u.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold ${
                            u.role === "super_admin"
                              ? "bg-slate-900 text-white"
                              : u.role === "ops_manager"
                              ? "bg-blue-600 text-white"
                              : "bg-emerald-600 text-white"
                          }`}
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
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
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

                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {currentRole === "super_admin" && (
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
                                  className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600"
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
                className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold ${def.badgeColor}`}>
                      {def.title}
                    </span>
                    <Icon className="h-5 w-5 text-slate-400" />
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">{def.description}</p>

                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Add Staff / User Account</h3>
              <Button size="sm" variant="ghost" onClick={() => setIsAddUserOpen(false)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleCreateUser} className="space-y-3 text-xs">
              {formError && (
                <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{formError}</p>
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
                  Initial Password (min 6 characters)
                </label>
                <Input
                  type="password"
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  minLength={6}
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
                  <option value="staff">Staff / Field Worker</option>
                  <option value="ops_manager">Operations Manager</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setIsAddUserOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={formBusy} className="bg-slate-900 text-white">
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
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">Edit User Details</h3>
              <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)} className="h-7 w-7 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <form onSubmit={handleUpdateUser} className="space-y-3 text-xs">
              {formError && (
                <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2.5 py-1.5">{formError}</p>
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
                  minLength={6}
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
                  <option value="staff">Staff / Field Worker</option>
                  <option value="ops_manager">Operations Manager</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setEditingUserId(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={formBusy} className="bg-slate-900 text-white">
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
