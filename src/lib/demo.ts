/**
 * Demo sign-in — one account per existing role, for client walkthroughs.
 *
 * Safe by construction:
 *   - OFF unless the server has DEMO_LOGINS_ENABLED=true (leave it unset in
 *     production). When off, the login page shows nothing and the API is 404.
 *   - No password ever reaches the browser: demo accounts are created by
 *     `npm run db:seed:demo` with a random, never-printed password, and the
 *     server signs them in by role (POST /api/auth/demo-login).
 *   - Demo accounts are ordinary accounts with their normal role permissions;
 *     the Customer demo opens the demo job's QR link (customers never sign in).
 */
export const DEMO_DOMAIN = "demo.intensecare.local";

export const DEMO_ACCOUNTS = [
  { role: "admin", label: "Admin", name: "Demo Admin", email: `admin@${DEMO_DOMAIN}` },
  { role: "field_manager", label: "Field Manager", name: "Demo Field Manager", email: `field.manager@${DEMO_DOMAIN}` },
  { role: "qc_inspector", label: "QC", name: "Demo QC", email: `qc@${DEMO_DOMAIN}` },
  { role: "tax_officer", label: "Tax Officer", name: "Demo Tax Officer", email: `tax.officer@${DEMO_DOMAIN}` },
] as const;

export type DemoRole = (typeof DEMO_ACCOUNTS)[number]["role"] | "customer";

/** The demo customer (signs in through the job's QR link, not a password). */
export const DEMO_CUSTOMER = { name: "Demo Customer", email: `customer@${DEMO_DOMAIN}`, phone: "+910000000000" };

export function demoLoginsEnabled(): boolean {
  return process.env.DEMO_LOGINS_ENABLED === "true";
}
