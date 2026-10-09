import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { createSession, toSessionUser } from "@/lib/server/session";
import { recordAudit } from "@/lib/server/audit";
import { ensureCustomerLink, rateLimit, clientIp } from "@/lib/server/qr-service";
import { errorResponse } from "@/lib/server/http";
import { logger } from "@/lib/server/logger";
import { canSignIn, homePathFor, normalizeRole } from "@/lib/rbac";
import { DEMO_ACCOUNTS, DEMO_CUSTOMER, demoLoginsEnabled } from "@/lib/demo";
import { ensureDemoAccounts } from "@/lib/server/demo-service";

const notFound = () => NextResponse.json({ success: false, error: "Not found." }, { status: 404 });

/**
 * GET /api/auth/demo-login — which demo buttons to show (none when demo
 * sign-in is off). Only accounts that exist and are active are listed.
 * Automatically provisions demo accounts if missing.
 */
export async function GET() {
  try {
    if (!demoLoginsEnabled()) return NextResponse.json({ success: true, data: { enabled: false, accounts: [] } });
    
    let users = await prisma.user.findMany({
      where: { email: { in: DEMO_ACCOUNTS.map((a) => a.email) }, active: true },
      select: { email: true },
    });

    if (users.length < DEMO_ACCOUNTS.length) {
      await ensureDemoAccounts();
      users = await prisma.user.findMany({
        where: { email: { in: DEMO_ACCOUNTS.map((a) => a.email) }, active: true },
        select: { email: true },
      });
    }

    const have = new Set(users.map((u) => u.email));
    const customer = await prisma.customer.findFirst({ where: { email: DEMO_CUSTOMER.email }, select: { id: true, jobs: { select: { id: true }, take: 1 } } });
    const accounts = [
      ...DEMO_ACCOUNTS.filter((a) => have.has(a.email)).map((a) => ({ role: a.role, label: a.label })),
      ...(customer?.jobs.length ? [{ role: "customer", label: "Customer" }] : []),
    ];
    return NextResponse.json({ success: true, data: { enabled: true, accounts } });
  } catch (err) {
    return errorResponse(err, "auth.demo.get_error");
  }
}

const BodySchema = z.object({ role: z.enum(["admin", "field_manager", "qc_inspector", "tax_officer", "customer"]) });

/**
 * POST /api/auth/demo-login { role } — signs in as that role's demo account
 * (no password involved: the demo account's password is random and unknown).
 * role "customer" returns the demo job's QR link instead — customers never
 * sign in. 404 whenever DEMO_LOGINS_ENABLED is not "true".
 */
export async function POST(request: Request) {
  try {
    if (!demoLoginsEnabled()) return notFound();
    const rl = rateLimit(`demo-login:${clientIp(request)}`, 30, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ success: false, error: "Too many demo sign-ins. Try again shortly." }, { status: 429 });

    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: "Unknown demo role." }, { status: 400 });
    const { role } = parsed.data;

    if (role === "customer") {
      let customer = await prisma.customer.findFirst({ where: { email: DEMO_CUSTOMER.email }, select: { id: true } });
      let job = customer
        ? await prisma.job.findFirst({ where: { customerId: customer.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true } })
        : null;
      if (!job) {
        await ensureDemoAccounts();
        customer = await prisma.customer.findFirst({ where: { email: DEMO_CUSTOMER.email }, select: { id: true } });
        job = customer
          ? await prisma.job.findFirst({ where: { customerId: customer.id, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, select: { id: true } })
          : null;
      }
      if (!job) return NextResponse.json({ success: false, error: "No demo customer job available." }, { status: 404 });
      const link = await ensureCustomerLink(job.id, { name: "Demo" });
      if (!link.success) return NextResponse.json({ success: false, error: link.failure.message }, { status: 500 });
      logger.info("auth.demo.customer_link", { jobId: job.id });
      return NextResponse.json({ success: true, data: { redirect: link.data.linkPath } });
    }

    const account = DEMO_ACCOUNTS.find((a) => a.role === role)!;
    let user = await prisma.user.findUnique({ where: { email: account.email } });
    if (!user || !user.active) {
      await ensureDemoAccounts();
      user = await prisma.user.findUnique({ where: { email: account.email } });
    }
    // Only a real, active demo account with the expected role — never anyone else.
    if (!user || !user.active || normalizeRole(user.role) !== role || !canSignIn(user.role)) {
      return NextResponse.json({ success: false, error: "This demo account is not set up." }, { status: 404 });
    }
    const session = toSessionUser(user);
    await createSession(session);
    logger.info("auth.demo.login", { userId: user.id, role: session.role });
    void recordAudit({ actor: session, action: "LOGIN", entityType: "user", entityId: user.id, details: "demo sign-in", request });
    return NextResponse.json({ success: true, data: { redirect: homePathFor(session.role) } });
  } catch (err) {
    return errorResponse(err, "auth.demo.post_error");
  }
}
