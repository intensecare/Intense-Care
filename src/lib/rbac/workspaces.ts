/**
 * RBAC — role workspaces (§18).
 *
 * Each role has ONE home, ONE primary queue and ONE clear next action. The
 * navigation of a workspace is derived from the permission matrix — an item
 * is shown only when the role holds its permission — and the route guard
 * uses the same table, so a URL typed by hand lands on the role's home.
 */

import type { Role } from "./roles";
import { normalizeRole } from "./roles";
import type { Permission } from "./permissions";
import { scopeOf } from "./engine";

export type WorkspaceLayout = "desk" | "mobile" | "portal";

export interface NavItem {
  label: string;
  href: string;
  permission: Permission;
  /** Badge key the layout resolves from live data (optional). */
  badge?: "jobs_open" | "qc_pending" | "rework" | "approvals" | "overdue" | "dispatch";
}

export interface WorkspaceDef {
  role: Role;
  /** Workspace title shown in the header ("Business Overview", "My Jobs" …). */
  title: string;
  /** Home route — the ONE place the role lands after sign-in. */
  home: string;
  /** The ONE primary queue of the role. */
  queue: string;
  layout: WorkspaceLayout;
  nav: NavItem[];
}

export const WORKSPACES: Record<Role, WorkspaceDef> = {
  super_admin: {
    role: "super_admin",
    title: "Business Overview",
    home: "/",
    queue: "/operations",
    layout: "desk",
    nav: [
      { label: "Business Overview", href: "/", permission: "dashboard.view" },
      { label: "Operations", href: "/operations", permission: "jobs.view", badge: "jobs_open" },
      { label: "Schedule", href: "/schedule", permission: "scheduling.manage" },
      { label: "Jobs", href: "/jobs", permission: "jobs.view" },
      { label: "Quality Queue", href: "/quality-queue", permission: "qc.inspect", badge: "qc_pending" },
      { label: "Quality & Rework", href: "/quality", permission: "rework.view", badge: "rework" },
      { label: "Customers", href: "/customers", permission: "customers.view" },
      { label: "Properties", href: "/properties", permission: "properties.view" },
      { label: "AMC Contracts", href: "/amc", permission: "amc.view" },
      { label: "Quotations", href: "/quotations", permission: "quotes.manage" },
      { label: "Services & Checklists", href: "/services", permission: "services.manage" },
      { label: "Finance", href: "/finance", permission: "finance.view", badge: "overdue" },
      { label: "Referrals & Partners", href: "/referrals", permission: "referrals.manage" },
      { label: "Reports", href: "/reports", permission: "reports.view" },
      { label: "Notifications", href: "/notifications", permission: "notifications.view" },
      { label: "Users & Roles", href: "/users", permission: "users.manage" },
      { label: "Settings & Audit", href: "/settings", permission: "settings.manage" },
      { label: "Field App", href: "/my-jobs", permission: "jobs.arrive" },
    ],
  },
  ops_manager: {
    role: "ops_manager",
    title: "Operations",
    home: "/operations",
    queue: "/operations",
    layout: "desk",
    nav: [
      { label: "Operations", href: "/operations", permission: "jobs.view", badge: "jobs_open" },
      { label: "Schedule", href: "/schedule", permission: "scheduling.manage" },
      { label: "Dispatch", href: "/dispatcher", permission: "jobs.assign", badge: "dispatch" },
      { label: "Jobs", href: "/jobs", permission: "jobs.view" },
      { label: "Calendar", href: "/calendar", permission: "scheduling.view" },
      { label: "Quality & Rework", href: "/quality", permission: "rework.view", badge: "rework" },
      { label: "Customers", href: "/customers", permission: "customers.view" },
      { label: "Properties", href: "/properties", permission: "properties.view" },
      { label: "AMC Contracts", href: "/amc", permission: "amc.view" },
      { label: "Services & Checklists", href: "/services", permission: "checklist.manage" },
      { label: "Staff", href: "/users", permission: "users.view" },
      { label: "Reports", href: "/reports", permission: "reports.view" },
      { label: "Notifications", href: "/notifications", permission: "notifications.view" },
    ],
  },
  scheduler: {
    role: "scheduler",
    title: "Schedule",
    home: "/schedule",
    queue: "/schedule",
    layout: "desk",
    nav: [
      { label: "Schedule", href: "/schedule", permission: "scheduling.manage" },
      { label: "Dispatch", href: "/dispatcher", permission: "jobs.assign", badge: "dispatch" },
      { label: "Jobs", href: "/jobs", permission: "jobs.view" },
      { label: "Calendar", href: "/calendar", permission: "scheduling.view" },
      { label: "Customers", href: "/customers", permission: "customers.view" },
      { label: "Properties", href: "/properties", permission: "properties.view" },
      { label: "AMC Visits", href: "/amc", permission: "amc.view" },
    ],
  },
  field_manager: {
    role: "field_manager",
    title: "My Jobs",
    home: "/my-jobs",
    queue: "/my-jobs",
    layout: "mobile",
    nav: [{ label: "My Jobs", href: "/my-jobs", permission: "jobs.view" }],
  },
  field_staff: {
    role: "field_staff",
    title: "My Tasks",
    home: "/my-tasks",
    queue: "/my-tasks",
    layout: "mobile",
    nav: [{ label: "My Tasks", href: "/my-tasks", permission: "checklist.execute" }],
  },
  qc_inspector: {
    role: "qc_inspector",
    title: "Quality Queue",
    home: "/quality-queue",
    queue: "/quality-queue",
    layout: "desk",
    nav: [
      { label: "Quality Queue", href: "/quality-queue", permission: "qc.inspect", badge: "qc_pending" },
      { label: "Rework Tracker", href: "/quality", permission: "rework.view", badge: "rework" },
    ],
  },
  accounts: {
    role: "accounts",
    title: "Finance",
    home: "/finance",
    queue: "/finance",
    layout: "desk",
    nav: [
      { label: "Finance", href: "/finance", permission: "finance.view", badge: "overdue" },
      { label: "Billable Jobs", href: "/jobs", permission: "jobs.view" },
      { label: "Customers", href: "/customers", permission: "customers.view" },
      { label: "Referral Payouts", href: "/referrals", permission: "payouts.manage" },
      { label: "Reports", href: "/reports", permission: "reports.financial" },
    ],
  },
  referral_partner: {
    role: "referral_partner",
    title: "My Referrals",
    home: "/my-referrals",
    queue: "/my-referrals",
    layout: "portal",
    nav: [{ label: "My Referrals", href: "/my-referrals", permission: "referrals.view" }],
  },
  customer: {
    role: "customer",
    title: "My Services",
    home: "/my-services",
    queue: "/my-services",
    layout: "portal",
    nav: [{ label: "My Services", href: "/my-services", permission: "jobs.view" }],
  },
};

/**
 * Routes outside a workspace's nav that a role may still open, each gated by
 * a permission. Detail pages (job file, customer file) live here.
 */
const ROUTE_PERMISSIONS: { prefix: string; permission: Permission; layouts: WorkspaceLayout[] }[] = [
  { prefix: "/jobs/", permission: "jobs.view", layouts: ["desk"] },
  { prefix: "/customers/", permission: "customers.view", layouts: ["desk"] },
  { prefix: "/quality-queue/", permission: "qc.inspect", layouts: ["desk"] },
  { prefix: "/my-jobs/", permission: "jobs.view", layouts: ["mobile", "desk"] },
  { prefix: "/my-tasks/", permission: "checklist.execute", layouts: ["mobile", "desk"] },
  { prefix: "/my-services/", permission: "jobs.view", layouts: ["portal"] },
  { prefix: "/field", permission: "checklist.execute", layouts: ["mobile", "desk"] },
];

/** Paths that need no sign-in (secure links, public partner code portal). */
export const PUBLIC_PATH_PREFIXES = ["/login", "/customer/", "/portal", "/partner-portal", "/refer/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function workspaceFor(role: Role | string): WorkspaceDef {
  return WORKSPACES[normalizeRole(role)];
}

export function homePathFor(role: Role | string): string {
  return workspaceFor(role).home;
}

/** Navigation items the role actually holds the permission for. */
export function navFor(role: Role | string): NavItem[] {
  const r = normalizeRole(role);
  return WORKSPACES[r].nav.filter((item) => scopeOf(r, item.permission) !== "NONE");
}

/** May the role open this path? Derived from nav + ROUTE_PERMISSIONS + matrix. */
export function routeAllowed(role: Role | string, pathname: string): boolean {
  const r = normalizeRole(role);
  const ws = WORKSPACES[r];
  if (isPublicPath(pathname)) return true;
  if (navFor(r).some((n) => n.href === pathname || (n.href !== "/" && pathname.startsWith(n.href + "/")) || (n.href !== "/" && pathname === n.href))) {
    return true;
  }
  if (pathname === "/" && ws.home === "/") return true;
  return ROUTE_PERMISSIONS.some(
    (rp) =>
      pathname.startsWith(rp.prefix) &&
      rp.layouts.includes(ws.layout) &&
      scopeOf(r, rp.permission) !== "NONE"
  );
}
