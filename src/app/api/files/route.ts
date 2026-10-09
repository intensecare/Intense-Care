import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { requireUser, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail } from "@/lib/server/serialize";
import { storeUpload } from "@/lib/server/files";
import { recordAudit } from "@/lib/server/audit";
import { rateLimit } from "@/lib/server/qr-service";
import { can } from "@/lib/rbac";

/**
 * POST /api/files (multipart: file, ownerType, ownerId?, category?, label?, expiresOn?)
 *   expense  — a receipt / bill: Admin, or a Field Manager submitting an expense.
 *              Uploaded first, then attached by creating the expense with `receiptFileId`.
 *   employee — an HR document (ID proof, agreement, certificate): hr.sensitive only.
 */
const Meta = z.object({
  ownerType: z.enum(["expense", "employee"]),
  ownerId: z.string().max(64).optional(),
  category: z.enum(["RECEIPT", "ID_PROOF", "AGREEMENT", "CERTIFICATE", "OTHER"]).optional(),
  label: z.string().max(120).optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    if (!rateLimit(`upload:${user.id}`, 30, 10 * 60 * 1000).ok) return fail("Too many uploads. Please wait a few minutes.", 429);
    const form = await request.formData().catch(() => null);
    if (!form) return fail("Send the file as a form upload.", 400);
    const meta = Meta.safeParse({
      ownerType: form.get("ownerType") ?? undefined,
      ownerId: form.get("ownerId") || undefined,
      category: form.get("category") || undefined,
      label: form.get("label") || undefined,
      expiresOn: form.get("expiresOn") || undefined,
    });
    if (!meta.success) return fail("Say what the file is for.", 400);
    const file = form.get("file");
    if (!(file instanceof File)) return fail("Choose a file to upload.", 400);

    const m = meta.data;
    if (m.ownerType === "expense") {
      if (!can(user, "expenses.manage") && !can(user, "expenses.submit")) throw new HttpError(403, "Your role is not authorized for this action.");
      if (m.ownerId) {
        const e = await prisma.expense.findUnique({ where: { id: m.ownerId }, select: { createdBy: true, receiptFileId: true } });
        if (!e) return fail("Expense not found.", 404);
        if (!can(user, "expenses.manage") && e.createdBy !== user.id) throw new HttpError(403, "You can only add a receipt to your own expense.");
      }
    } else {
      if (!can(user, "hr.sensitive")) throw new HttpError(403, "Your role is not authorized for this action.");
      if (!m.ownerId || !(await prisma.employee.findUnique({ where: { id: m.ownerId }, select: { id: true } }))) return fail("Employee not found.", 404);
    }

    const saved = await storeUpload({ file, ownerType: m.ownerType, ownerId: m.ownerId, category: m.category ?? (m.ownerType === "expense" ? "RECEIPT" : "OTHER"), label: m.label, expiresOn: m.expiresOn, uploadedBy: user.id });
    if (m.ownerType === "expense" && m.ownerId) await prisma.expense.update({ where: { id: m.ownerId }, data: { receiptFileId: saved.id } });
    void recordAudit({ actor: user, action: "FILE_UPLOADED", entityType: m.ownerType, entityId: m.ownerId ?? saved.id, details: `${saved.fileName} (${saved.mimeType}, ${saved.sizeBytes} bytes)`, request });
    return ok(saved, 201);
  } catch (err) {
    return errorResponse(err, "files.post.route_error");
  }
}
