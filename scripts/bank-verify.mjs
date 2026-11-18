// End-to-end check of Bank Accounts, invoice/quotation bank mapping, payment receiving
// accounts, and reconciliation — run AFTER scripts/e2e-verify.mjs against the same
// server + database (or a fresh seeded one; it creates its own fixtures either way).
//
//   DATABASE_URL=… BASE_URL=http://localhost:3101 node scripts/bank-verify.mjs
const BASE = process.env.BASE_URL || "http://localhost:3100";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("PASS", m); } else { fail++; console.log("FAIL", m); } };

function client() {
  let cookie = "";
  return async (path, { method = "GET", body, raw } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  };
}
const login = async (email, password) => { const c = client(); await c("/api/auth/login", { method: "POST", body: { email, password } }); return c; };

const admin = await login("admin@test.local", "adminpass123");

// --- Bank account CRUD -------------------------------------------------------
const r1 = await admin("/api/bank-accounts", { method: "POST", body: {
  displayName: "HDFC Current - Ops", holderName: "Intense Care Services", bankName: "HDFC Bank",
  accountNumber: "50100123456789", ifsc: "HDFC0001234", branch: "Koramangala", upiId: "intensecare@hdfcbank",
} });
ok(r1.status === 201, "create first bank account");
const acc1 = r1.json?.data;
ok(acc1?.isDefault === true, "first account becomes the default automatically");
ok(acc1?.accountNumber === "50100123456789", "full account number returned to Admin");
ok(acc1?.accountNumberMasked === "••••••6789", "masked view computed correctly");

const r1b = await admin("/api/bank-accounts", { method: "POST", body: {
  displayName: "ICICI Current - Ops", holderName: "Intense Care Services", bankName: "ICICI Bank",
  accountNumber: "000401234567", ifsc: "ICIC0001234",
} });
const acc2 = r1b.json?.data;
ok(acc2 && !acc2.isDefault, "second account is not default by default");

ok((await admin("/api/bank-accounts", { method: "POST", body: { displayName: "x", holderName: "x", bankName: "x", accountNumber: "123", ifsc: "BAD" } })).status === 400, "rejects invalid account number / IFSC");

const list = await admin("/api/bank-accounts");
ok(list.json?.data?.length === 2, "lists both accounts");

const setDef = await admin(`/api/bank-accounts/${acc2.id}`, { method: "PATCH", body: { action: "set-default" } });
ok(setDef.json?.data?.isDefault === true, "set-default works");
const after = await admin("/api/bank-accounts");
ok(after.json.data.find((a) => a.id === acc1.id).isDefault === false, "old default is cleared when a new one is set");

await admin(`/api/bank-accounts/${acc1.id}`, { method: "PATCH", body: { action: "set-default" } });

await admin(`/api/bank-accounts/${acc2.id}`, { method: "PATCH", body: { action: "set-status", status: "INACTIVE" } });
const afterDeactivate = await admin("/api/bank-accounts");
ok(afterDeactivate.json.data.find((a) => a.id === acc2.id).status === "INACTIVE", "account deactivated");

// --- Quotation bank mapping ---------------------------------------------------
const svc = (await admin("/api/services", { method: "POST", body: { name: "Deep Clean 2BHK BV", basePrice: 4999, estimatedDurationHours: 4, checklistTemplate: [{ area: "Kitchen", task: "Degrease hob", critical: true }] } })).json?.data;
const cust = (await admin("/api/customers", { method: "POST", body: { name: "Bank Verify Customer", phone: "+919811112222" } })).json?.data;
const prop = (await admin("/api/properties", { method: "POST", body: { customerId: cust.id, title: "BV Flat", address: "1 BV Street, Bengaluru" } })).json?.data;

const quoteR = await admin("/api/quotations", { method: "POST", body: {
  customerId: cust.id, propertyId: prop.id, items: [{ serviceId: svc.id, description: svc.name, quantity: 1, rate: 4999 }],
  discount: 0, quoteType: "GST", interState: false, validUntil: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
  bankAccountId: acc2.id, status: "sent",
} });
ok(quoteR.status === 400, "an INACTIVE bank account cannot be chosen on a quotation");

const quoteR2 = await admin("/api/quotations", { method: "POST", body: {
  customerId: cust.id, propertyId: prop.id, items: [{ serviceId: svc.id, description: svc.name, quantity: 1, rate: 4999 }],
  discount: 0, quoteType: "GST", interState: false, validUntil: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
  status: "sent",
} });
ok(quoteR2.status === 201, "quotation created without a bank account choice (estimate — not forced)");
ok(!quoteR2.json.data.bankAccountId, "quotation has no bank account when none was chosen");

// --- Job creation → invoice inherits the company DEFAULT bank account --------
const today = new Date().toISOString().slice(0, 10);
const jobR = await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "09:00 - 13:00" } });
const job = jobR.json?.data?.job;
const invoiceId = jobR.json?.data?.invoice?.id;
ok(job?.id && invoiceId, "job + invoice created");
const inv = (await admin(`/api/invoices/${invoiceId}`)).json?.data?.invoice;
ok(inv.bankAccountId === acc1.id, "new invoice defaults to the company's default bank account");
ok(inv.bankAccountSnapshot?.accountNumber === "50100123456789", "invoice carries a frozen snapshot of the account at issue time");

const jobR2 = await admin("/api/jobs", { method: "POST", body: { customerId: cust.id, propertyId: prop.id, serviceId: svc.id, scheduledDate: today, scheduledTimeSlot: "14:00 - 18:00", bankAccountId: acc2.id } });
ok(jobR2.status === 400, `an inactive bank account cannot be assigned to a new job's invoice (got ${jobR2.status}: ${JSON.stringify(jobR2.json)})`);

// --- Historical preservation: editing the live account never rewrites the issued invoice ---
await admin(`/api/bank-accounts/${acc1.id}`, { method: "PATCH", body: { action: "update", displayName: "HDFC Current - Ops (renamed)", accountNumber: "50100999999999" } });
const invAfterEdit = (await admin(`/api/invoices/${invoiceId}`)).json?.data?.invoice;
ok(invAfterEdit.bankAccountSnapshot?.accountNumber === "50100123456789", "issued invoice's snapshot is UNCHANGED after the live account is edited");
ok(invAfterEdit.bankAccountId === acc1.id, "invoice still points at the same account id");

const pdf = await admin(`/api/invoices/${invoiceId}/pdf`, { raw: true });
const pdfBuf = Buffer.from(await pdf.arrayBuffer());
ok(pdf.status === 200, "invoice PDF generates (200)");
ok(pdfBuf.slice(0, 5).toString() === "%PDF-", "invoice PDF output is a real PDF");

const correct = await admin("/api/finance", { method: "POST", body: { action: "correct-invoice-bank-account", invoiceId, bankAccountId: null, reason: "Customer asked to pay into a different account than originally shown" } });
ok(correct.status === 200, "admin can correct an issued invoice's bank account with a reason");
ok(correct.json.data.bankAccountId == null, "correction applied");
await admin("/api/finance", { method: "POST", body: { action: "correct-invoice-bank-account", invoiceId, bankAccountId: acc1.id, reason: "Reverting test correction" } });

// --- Payment recording with a receiving account -------------------------------
const payR = await admin("/api/finance", { method: "POST", body: { action: "record-payment", invoiceId, amount: inv.total, paymentMethod: "bank_transfer", reference: "BVTXN001", receivingBankAccountId: acc1.id } });
ok(payR.status === 201, "payment recorded with a receiving bank account");
const paymentId = payR.json.data.id;
ok(payR.json.data.receivingBankAccountId === acc1.id, "payment records which account the money actually went to");

const detail1 = await admin(`/api/bank-accounts/${acc1.id}`);
ok(detail1.json.data.collectedTotal >= inv.total, "account detail reports collected total including this payment");
ok(detail1.json.data.invoicedTotal >= inv.total, "account detail reports invoiced total separately from collected");

// --- Reconciliation: CSV import + match + duplicate prevention ---------------
const csv = `Date,Description,Amount,Reference\n${today.split("-").reverse().join("/")},NEFT CR BV Verify Customer,${inv.total},BVTXN001\n`;
const imp = await admin(`/api/bank-accounts/${acc1.id}/import`, { method: "POST", body: { csv } });
ok(imp.status === 201 && imp.json.data.imported === 1, "CSV statement imported as 1 UNMATCHED transaction");

const imp2 = await admin(`/api/bank-accounts/${acc1.id}/import`, { method: "POST", body: { csv } });
ok(imp2.json.data.imported === 0 && imp2.json.data.skippedDuplicate === 1, "re-importing the same file is deduplicated");

const txns = await admin(`/api/bank-transactions?bankAccountId=${acc1.id}`);
const txn = txns.json.data.transactions.find((t) => t.reference === "BVTXN001");
ok(!!txn && txn.status === "UNMATCHED", "the imported transaction is UNMATCHED");
ok(txns.json.data.unmatchedPayments.some((p) => p.id === paymentId), "the recorded payment appears in the unmatched-payments pool");

const matchR = await admin(`/api/bank-transactions/${txn.id}/match`, { method: "POST", body: { paymentId } });
ok(matchR.status === 201 && matchR.json.data.status === "MATCHED", "transaction matched to the payment exactly (full amount)");

const matchAgain = await admin(`/api/bank-transactions/${txn.id}/match`, { method: "POST", body: { paymentId } });
ok(matchAgain.status === 409, "the SAME transaction cannot be reconciled a second time");

const txns2 = await admin(`/api/bank-transactions?bankAccountId=${acc1.id}`);
ok(txns2.json.data.transactions.find((t) => t.id === txn.id).status === "MATCHED", "transaction now shows MATCHED");
ok(!txns2.json.data.unmatchedPayments.some((p) => p.id === paymentId), "matched payment leaves the unmatched-payments pool");

const unmatch = await admin(`/api/bank-transactions/${txn.id}/match`, { method: "DELETE" });
ok(unmatch.status === 200, "reconciliation can be reversed");
const txns3 = await admin(`/api/bank-transactions?bankAccountId=${acc1.id}`);
ok(txns3.json.data.transactions.find((t) => t.id === txn.id).status === "UNMATCHED", "after reversal the transaction is UNMATCHED again");
ok(txns3.json.data.unmatchedPayments.some((p) => p.id === paymentId), "after reversal the payment is matchable again");
const rematch = await admin(`/api/bank-transactions/${txn.id}/match`, { method: "POST", body: { paymentId } });
ok(rematch.status === 201, "the same transaction can be re-matched after a reversal");

// --- Security: non-admin cannot reach any of this -----------------------------
const mkFm = await admin("/api/users", { method: "POST", body: { name: "FM One", email: "fm1@test.local", phone: "+919800000001", role: "field_operations_manager", password: "password123" } });
ok(mkFm.status === 200 || mkFm.status === 201, "created a Field Operations Manager for the negative-access test");
const fmc = await login("fm1@test.local", "password123");
ok((await fmc("/api/bank-accounts")).status === 403, "Field Operations Manager is denied /api/bank-accounts");
ok((await fmc(`/api/bank-accounts/${acc1.id}`)).status === 403, "Field Operations Manager is denied account detail");
ok((await fmc(`/api/bank-transactions?bankAccountId=${acc1.id}`)).status === 403, "Field Operations Manager is denied reconciliation data");
ok((await fmc("/api/bank-accounts", { method: "POST", body: { displayName: "x", holderName: "x", bankName: "x", accountNumber: "123456", ifsc: "HDFC0001234" } })).status === 403, "Field Operations Manager cannot create a bank account");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
