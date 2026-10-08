import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { fail } from "@/lib/server/serialize";
import { recordAudit } from "@/lib/server/audit";
import { createPropertyAccessLink, getPropertyAccessLink, revokePropertyAccessLink } from "@/lib/server/property-access";

/**
 * /api/properties/[id]/access-link — the ONE optional property QR (Admin).
 *   GET     current link (null when none)
 *   POST    create, or replace (the old printed QR stops working)
 *   DELETE  turn the QR off
 */
async function load(id: string) {
  const property = await prisma.property.findUnique({ where: { id }, select: { id: true } });
  return property;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("links.manage");
    if (!(await load(params.id))) return fail("Property not found.", 404);
    return NextResponse.json({ success: true, data: { url: await getPropertyAccessLink(params.id) } });
  } catch (err) {
    return errorResponse(err, "properties.access_link.get_error");
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("links.manage");
    if (!(await load(params.id))) return fail("Property not found.", 404);
    const url = await createPropertyAccessLink(params.id);
    void recordAudit({ actor: user, action: "PROPERTY_QR_CREATED", entityType: "property", entityId: params.id, request });
    return NextResponse.json({ success: true, data: { url } });
  } catch (err) {
    return errorResponse(err, "properties.access_link.post_error");
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requirePermission("links.manage");
    if (!(await load(params.id))) return fail("Property not found.", 404);
    await revokePropertyAccessLink(params.id);
    void recordAudit({ actor: user, action: "PROPERTY_QR_REVOKED", entityType: "property", entityId: params.id, request });
    return NextResponse.json({ success: true, data: { url: null } });
  } catch (err) {
    return errorResponse(err, "properties.access_link.delete_error");
  }
}
