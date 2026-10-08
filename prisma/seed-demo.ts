import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import "dotenv/config";
import { DEMO_ACCOUNTS, DEMO_CUSTOMER } from "../src/lib/demo";
import { nextJobSerial } from "../src/lib/server/job-serial";
import { computeInvoiceFigures } from "../src/lib/tax";
import { nextInvoiceNumber } from "../src/lib/server/invoices";

/**
 * Demo data for walkthroughs — run with: npm run db:seed:demo
 *
 *   - One account per sign-in role (Admin, Field Manager, QC, Tax Officer).
 *     Each gets a long random password that is never printed or stored in
 *     plain text: demo accounts are entered only through the server-side demo
 *     sign-in (DEMO_LOGINS_ENABLED=true).
 *   - A demo customer with one job today, assigned to the demo Field Manager,
 *     with a GST invoice — so every role (and the customer's QR page) has
 *     something to show.
 * Safe to re-run: accounts are upserted and the demo job is created once.
 */
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const ids: Record<string, string> = {};
  for (const a of DEMO_ACCOUNTS) {
    const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
    const u = await prisma.user.upsert({
      where: { email: a.email },
      create: { name: a.name, email: a.email, phone: "", role: a.role, passwordHash, active: true },
      update: { name: a.name, role: a.role, passwordHash, active: true },
    });
    ids[a.role] = u.id;
    console.log(`Demo ${a.label}: ${a.email}`);
  }

  // Demo catalogue + customer + job (only once).
  const service =
    (await prisma.service.findFirst({ where: { active: true }, include: { checklistTemplate: true } })) ??
    (await prisma.service.create({
      data: {
        name: "Deep Clean 2BHK",
        slug: `deep-clean-2bhk-demo`,
        description: "Full home deep cleaning",
        basePrice: 4999,
        estimatedDurationHours: 4,
        checklistTemplate: {
          create: [
            { area: "Kitchen", task: "Degrease hob and chimney", critical: true, position: 0 },
            { area: "Kitchen", task: "Clean cabinets inside and out", position: 1 },
            { area: "Bathroom", task: "Descale tiles and fittings", critical: true, position: 2 },
            { area: "Bedroom", task: "Dust and vacuum", position: 3 },
          ],
        },
      },
      include: { checklistTemplate: true },
    }));

  let customer = await prisma.customer.findFirst({ where: { email: DEMO_CUSTOMER.email } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { name: DEMO_CUSTOMER.name, email: DEMO_CUSTOMER.email, phone: DEMO_CUSTOMER.phone, address: "12 Lake Road, Bengaluru" },
    });
  }
  const existingJob = await prisma.job.findFirst({ where: { customerId: customer.id }, orderBy: { createdAt: "desc" } });
  if (existingJob) {
    console.log(`Demo customer job already exists: ${existingJob.jobSerial}`);
    return;
  }
  const property =
    (await prisma.property.findFirst({ where: { customerId: customer.id } })) ??
    (await prisma.property.create({ data: { customerId: customer.id, title: "Demo Lakeside Apartment", address: "12 Lake Road", city: "Bengaluru" } }));

  const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
  const figures = computeInvoiceFigures({ invoiceType: "GST", subtotal: service.basePrice, gstRatePercent: 18 });
  const job = await prisma.$transaction(async (tx) => {
    const j = await tx.job.create({
      data: {
        jobSerial: await nextJobSerial(tx, customer!.name, today),
        customerId: customer!.id,
        propertyId: property.id,
        serviceId: service.id,
        scheduledDate: today,
        scheduledTimeSlot: "10:00 - 14:00",
        assignedManagerId: ids.field_manager,
        amount: service.basePrice,
        status: "ASSIGNED",
        notes: "Demo job",
      },
    });
    if (service.checklistTemplate.length) {
      await tx.jobChecklistItem.createMany({ data: service.checklistTemplate.map((c) => ({ jobId: j.id, area: c.area, task: c.task, critical: c.critical })) });
    }
    await tx.invoice.create({
      data: {
        invoiceNumber: await nextInvoiceNumber(tx, "GST"),
        invoiceType: "GST",
        jobId: j.id,
        customerId: customer!.id,
        subtotal: figures.subtotal,
        tax: figures.tax,
        gstRate: figures.gstRate,
        cgst: figures.cgst,
        sgst: figures.sgst,
        igst: figures.igst,
        total: figures.total,
        balanceDue: figures.total,
        dueDate: today,
      },
    });
    return j;
  });
  console.log(`Demo customer job: ${job.jobSerial}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
