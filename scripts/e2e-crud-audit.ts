import { prisma } from "../src/lib/server/prisma";
import { computeInvoiceFigures } from "../src/lib/tax";
import bcrypt from "bcryptjs";

async function runE2ECrudAudit() {
  console.log("=== STARTING INTENSE CARE ERP COMPLETE CRUD AUDIT ===");
  const timestamp = Date.now();
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  [PASS] ${message}`);
      passedCount++;
    } else {
      console.error(`  [FAIL] ${message}`);
      failedCount++;
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  try {
    // 1. SERVICES CRUD
    console.log("\n1. Testing Services CRUD...");
    const serviceName = `Test Service ${timestamp}`;
    const service = await prisma.service.create({
      data: {
        name: serviceName,
        slug: `test-service-${timestamp}`,
        category: "residential",
        description: "Integration test cleaning service",
        basePrice: 1500,
        estimatedDurationHours: 2.5,
        checklistTemplate: {
          create: [
            { area: "Living Room", task: "Dust fixtures", critical: true, position: 0 },
            { area: "Kitchen", task: "Clean sink", critical: false, position: 1 },
          ],
        },
      },
      include: { checklistTemplate: true },
    });
    assert(service.id != null, "Service created in DB");
    assert(service.checklistTemplate.length === 2, "Service checklist items created");

    // Service Update
    const updatedService = await prisma.service.update({
      where: { id: service.id },
      data: { basePrice: 1800, notes: "Updated pricing notes" },
    });
    assert(updatedService.basePrice === 1800, "Service update persisted to DB");

    // 2. CUSTOMERS & PROPERTIES CRUD
    console.log("\n2. Testing Customers & Properties CRUD...");
    const customerPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;
    const customer = await prisma.customer.create({
      data: {
        name: `Test Customer ${timestamp}`,
        phone: customerPhone,
        email: `test_${timestamp}@example.com`,
        address: "123 Test Avenue, Koramangala",
        gstin: "29ABCDE1234F1Z5",
      },
    });
    assert(customer.id != null, "Customer created in DB");

    // Update Customer
    const updatedCust = await prisma.customer.update({
      where: { id: customer.id },
      data: { notes: "VIP client test notes" },
    });
    assert(updatedCust.notes === "VIP client test notes", "Customer update persisted");

    // Property Create
    const property = await prisma.property.create({
      data: {
        customerId: customer.id,
        title: "Test Penthouse",
        address: "Flat 402, Test Tower",
        city: "Bangalore",
        postalCode: "560034",
        propertyType: "apartment",
        bedrooms: 3,
        bathrooms: 3,
        areaSqFt: 1800,
      },
    });
    assert(property.id != null, "Property created in DB");

    // Property Update
    const updatedProp = await prisma.property.update({
      where: { id: property.id },
      data: { accessNotes: "Key under doormat" },
    });
    assert(updatedProp.accessNotes === "Key under doormat", "Property update persisted");

    // 3. USERS CRUD
    console.log("\n3. Testing Users CRUD...");
    const userEmail = `fm_${timestamp}@intensecare.test`;
    const passwordHash = await bcrypt.hash("Password123!", 10);
    const user = await prisma.user.create({
      data: {
        name: `Test FM ${timestamp}`,
        email: userEmail,
        phone: `91${Math.floor(10000000 + Math.random() * 90000000)}`,
        role: "field_manager",
        passwordHash,
        active: true,
      },
    });
    assert(user.id != null, "User created in DB");

    // User Update & Toggle
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { active: false },
    });
    assert(updatedUser.active === false, "User deactivated and persisted");

    // 4. QUOTATIONS CRUD
    console.log("\n4. Testing Quotations CRUD...");
    const quoteNumber = `QT-TEST-${timestamp}`;
    const qFigs = computeInvoiceFigures({
      invoiceType: "GST",
      subtotal: 1800,
      discount: 100,
      gstRatePercent: 18,
      interState: false,
    });
    const quote = await prisma.quote.create({
      data: {
        quoteNumber,
        customerId: customer.id,
        propertyId: property.id,
        serviceId: service.id,
        validUntil: "2026-10-30",
        status: "draft",
        subtotal: qFigs.subtotal,
        tax: qFigs.tax,
        cgst: qFigs.cgst,
        sgst: qFigs.sgst,
        igst: qFigs.igst,
        discount: 100,
        total: qFigs.total,
        quoteType: "GST",
        gstRate: 18,
      },
    });
    assert(quote.id != null, "Quotation created in DB");

    // Quotation Update
    const updatedQuote = await prisma.quote.update({
      where: { id: quote.id },
      data: { discount: 200, total: 1888 },
    });
    assert(updatedQuote.discount === 200, "Quotation update persisted");

    // 5. JOBS & INVOICES CRUD
    console.log("\n5. Testing Jobs & Invoices CRUD...");
    const jobSerial = `JOB-TEST-${timestamp}`;
    const job = await prisma.job.create({
      data: {
        jobSerial,
        customerId: customer.id,
        propertyId: property.id,
        serviceId: service.id,
        scheduledDate: "2026-10-20",
        scheduledTimeSlot: "10:00 AM - 01:00 PM",
        status: "BOOKED",
        amount: 1800,
        assignedManagerId: user.id,
        notes: "Job notes test",
      },
    });
    assert(job.id != null, "Job created in DB");

    // Job Checklist Items
    const checklistItem = await prisma.jobChecklistItem.create({
      data: {
        jobId: job.id,
        area: "Living Room",
        task: "Deep dust fixtures",
        status: "completed",
        completedBy: user.id,
      },
    });
    assert(checklistItem.id != null, "Job checklist item created & linked");

    // Invoice Create
    const invoiceNumber = `INV-TEST-${timestamp}`;
    const invFigs = computeInvoiceFigures({
      invoiceType: "GST",
      subtotal: 1800,
      discount: 200,
      gstRatePercent: 18,
      interState: false,
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber,
        jobId: job.id,
        customerId: customer.id,
        subtotal: invFigs.subtotal,
        tax: invFigs.tax,
        cgst: invFigs.cgst,
        sgst: invFigs.sgst,
        igst: invFigs.igst,
        discount: 200,
        total: invFigs.total,
        balanceDue: invFigs.total,
        dueDate: "2026-10-27",
        status: "UNPAID",
        invoiceType: "GST",
        gstRate: 18,
      },
    });
    assert(invoice.id != null, "Invoice created in DB");

    // Invoice Update / Void
    const updatedInv = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED" },
    });
    assert(updatedInv.status === "CANCELLED", "Invoice cancelled & status persisted");

    // Delete Invoice
    await prisma.invoice.delete({ where: { id: invoice.id } });
    const invCheck = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    assert(invCheck == null, "Cancelled invoice deleted cleanly");

    // Delete Quotation
    await prisma.quote.delete({ where: { id: quote.id } });
    const quoteCheck = await prisma.quote.findUnique({ where: { id: quote.id } });
    assert(quoteCheck == null, "Draft quotation deleted cleanly");

    // 6. EXPENSES CRUD
    console.log("\n6. Testing Expenses CRUD...");
    const expenseNumber = `EXP-TEST-${timestamp}`;
    const expense = await prisma.expense.create({
      data: {
        expenseNumber,
        date: "2026-10-09",
        category: "CLEANING_SUPPLIES",
        description: "Test Floor Chemical 5L",
        amount: 850,
        taxAmount: 153,
        paymentMethod: "upi",
        paymentStatus: "PENDING",
        approvalStatus: "PENDING_APPROVAL",
        createdBy: user.id,
      },
    });
    assert(expense.id != null, "Expense created in DB");

    // Update & Approve Expense
    const approvedExpense = await prisma.expense.update({
      where: { id: expense.id },
      data: { approvalStatus: "APPROVED", approvedBy: "Admin:Tester", approvedAt: new Date() },
    });
    assert(approvedExpense.approvalStatus === "APPROVED", "Expense approved & persisted");

    // Delete Expense
    await prisma.expense.delete({ where: { id: expense.id } });
    const expCheck = await prisma.expense.findUnique({ where: { id: expense.id } });
    assert(expCheck == null, "Expense deleted cleanly");

    // 7. HR EMPLOYEES CRUD
    console.log("\n7. Testing HR Employees CRUD...");
    const employeeCode = `EMP-TEST-${timestamp}`;
    const employee = await prisma.employee.create({
      data: {
        employeeCode,
        fullName: `Staff Member ${timestamp}`,
        phone: `93${Math.floor(10000000 + Math.random() * 90000000)}`,
        employmentType: "PERMANENT",
        status: "ACTIVE",
        department: "Operations",
        designation: "Lead Cleaner",
        skills: ["deep_cleaning", "sanitization"],
        createdBy: user.id,
      },
    });
    assert(employee.id != null, "Employee created in DB");

    // Update Employee
    const updatedEmp = await prisma.employee.update({
      where: { id: employee.id },
      data: { designation: "Senior Supervisor" },
    });
    assert(updatedEmp.designation === "Senior Supervisor", "Employee update persisted");

    // Delete Employee (without job history)
    await prisma.employee.delete({ where: { id: employee.id } });
    const empCheck = await prisma.employee.findUnique({ where: { id: employee.id } });
    assert(empCheck == null, "Employee deleted cleanly");

    // 8. REFERRALS CRUD
    console.log("\n8. Testing Referrals CRUD...");
    const referralNumber = `REF-TEST-${timestamp}`;
    const referral = await prisma.referral.create({
      data: {
        referralNumber,
        referrerName: "Referrer Person",
        referrerContact: "9876543210",
        referredName: "Referred Person",
        referredContact: "9876543211",
        referralDate: "2026-10-09",
        source: "customer",
        status: "CREATED",
        referredPhoneKey: `key_${timestamp}`,
        createdBy: user.id,
      },
    });
    assert(referral.id != null, "Referral created in DB");

    // Delete Referral
    await prisma.referral.delete({ where: { id: referral.id } });
    const refCheck = await prisma.referral.findUnique({ where: { id: referral.id } });
    assert(refCheck == null, "Referral deleted cleanly");

    // 9. CLEANUP JOB, PROPERTY, CUSTOMER, USER, SERVICE
    console.log("\n9. Testing Safe Cleanup & Cascade Deletions...");
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: job.id } });
    await prisma.job.delete({ where: { id: job.id } });
    assert((await prisma.job.findUnique({ where: { id: job.id } })) == null, "Job deleted");

    await prisma.user.delete({ where: { id: user.id } });
    assert((await prisma.user.findUnique({ where: { id: user.id } })) == null, "User deleted");

    await prisma.property.delete({ where: { id: property.id } });
    assert((await prisma.property.findUnique({ where: { id: property.id } })) == null, "Property deleted");

    await prisma.customer.delete({ where: { id: customer.id } });
    assert((await prisma.customer.findUnique({ where: { id: customer.id } })) == null, "Customer deleted");

    await prisma.serviceChecklistItem.deleteMany({ where: { serviceId: service.id } });
    await prisma.service.delete({ where: { id: service.id } });
    assert((await prisma.service.findUnique({ where: { id: service.id } })) == null, "Service deleted");

    console.log("\n=== AUDIT RESULTS ===");
    console.log(`Passed Checks: ${passedCount}`);
    console.log(`Failed Checks: ${failedCount}`);
    console.log("ALL CRUD OPERATIONS VERIFIED END-TO-END AGAINST LIVE DATABASE!");
  } catch (err: any) {
    console.error("\nAudit error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runE2ECrudAudit();
