import { prisma } from "@/lib/server/prisma";
import { requireUser, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { ok, fail } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { can } from "@/lib/rbac";

/** Who may open a stored file — decided on the server for every request. */
async function authorize(user: Awaited<ReturnType<typeof requireUser>>["user"], file: { ownerType: string; ownerId: string | null; uploadedBy: string }) {
  if (file.ownerType === "employee") return can(user, "hr.sensitive");
  if (file.ownerType === "expense") {
    if (can(user, "expenses.view") || can(user, "expenses.manage")) return true;
    // A Field Manager sees only the receipts they uploaded themselves.
    return can(user, "expenses.submit") && file.uploadedBy === user.id;
  }
  return false;
}

/** GET /api/files/[id] — the file bytes (never cached, never sniffed). */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser();
    const f = await prisma.storedFile.findUnique({ where: { id: params.id } });
    // Same answer for "missing" and "not yours" so ids can't be probed.
    if (!f || !(await authorize(user, f))) return fail("File not found.", 404);
    return new Response(new Uint8Array(f.data), {
      headers: {
        "Content-Type": f.mimeType,
        "Content-Length": String(f.sizeBytes),
        "Content-Disposition": `inline; filename="${f.fileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err) {
    return errorResponse(err, "files.get.route_error");
  }
}

/** DELETE /api/files/[id] — an HR document only (receipts stay with their expense for the record). */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser();
    const f = await prisma.storedFile.findUnique({ where: { id: params.id }, select: { id: true, ownerType: true, ownerId: true, fileName: true } });
    if (!f || f.ownerType !== "employee") return fail("File not found.", 404);
    if (!can(user, "hr.manage") || !can(user, "hr.sensitive")) throw new HttpError(403, "Your role is not authorized for this action.");
    await prisma.storedFile.delete({ where: { id: f.id } });
    void recordAudit({ actor: user, action: "FILE_DELETED", entityType: "employee", entityId: f.ownerId ?? f.id, details: f.fileName, request });
    return ok({ id: f.id, deleted: true });
  } catch (err) {
    return errorResponse(err, "files.delete.route_error");
  }
}
