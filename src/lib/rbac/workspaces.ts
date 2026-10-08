/**
 * RBAC — role workspaces.
 *
 * Four separate experiences, not one dashboard with hidden menus:
 *   Admin → "Operations"   Field Manager → "My Jobs"   QC → "Quality"
 *   Customer → "My Service" (the secure link — no sign-in)
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
  /** Workspace title shown in the header ("Operations", "My Jobs" …). */
  title: string;
  /** Home route — the ONE place the role lands after sign-in. */
  home: string;
  /** The ONE primary queue of the role. */
  queue: string;
  layout: WorkspaceLayout;
  nav: NavItem[];
}

export const WORKSPACES: Record<Role, WorkspaceDef> = {
  admin: {
    role: "admin",
    title: "Operations",
    home: "/",
    queue: "/",
    layout: "desk",
    nav: [
      { label: "Operations", href: "/", permission: "dashboard.view", badge: "jobs_open" },
      { label: "Jobs", href: "/jobs", permission: "jobs.view" },
      { label: "Schedule", href: "/schedule", permission: "scheduling.manage" },
      { label: "Quality", href: "/quality-queue", permission: "qc.view", badge: "qc_pending" },
      { label: "Customers", href: "/customers", permission: "customers.view" },
      { label: "Properties", href: "/properties", permission: "properties.view" },
      { label: "Services", href: "/services", permission: "services.manage" },
      { label: "Payments", href: "/finance", permission: "finance.view", badge: "overdue" },
      { label: "Reports", href: "/reports", permission: "reports.view" },
      { label: "Users", href: "/users", permission: "users.manage" },
      { label: "Settings", href: "/settings", permission: "settings.manage" },
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
  qc_inspector: {
    role: "qc_inspector",
    title: "Quality",
    home: "/quality-queue",
    queue: "/quality-queue",
    layout: "mobile",
    nav: [{ label: "Quality", href: "/quality-queue", permission: "qc.inspect", badge: "qc_pending" }],
  },
  customer: {
    // Customers never sign in — this entry only keeps the table total.
    role: "customer",
    title: "My Service",
    home: "/login",
    queue: "/login",
    layout: "portal",
    nav: [],
  },
};

/**
 * Routes outside a workspace's nav that a role may still open, each gated by
 * a permission. Detail pages (job file, customer file) live here.
 */
const ROUTE_PERMISSIONS: { prefix: string; permission: Permission; layouts: WorkspaceLayout[] }[] = [
  { prefix: "/jobs/", permission: "jobs.view", layouts: ["desk"] },
  { prefix: "/customers/", permission: "customers.view", layouts: ["desk"] },
  { prefix: "/quality-queue/", permission: "qc.inspect", layouts: ["desk", "mobile"] },
  { prefix: "/my-jobs/", permission: "jobs.arrive", layouts: ["mobile"] },
];

/** Paths that need no sign-in (login and the customer's secure links). */
export const PUBLIC_PATH_PREFIXES = ["/login", "/customer/"];

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
