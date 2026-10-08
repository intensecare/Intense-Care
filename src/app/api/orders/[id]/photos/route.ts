import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { api, body, HttpError } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { isCloudinaryConfigured, uploadJobPhoto } from "@/lib/server/cloudinary";
import { logActivity } from "@/lib/server/orders";

const Schema = z.object({ image: z.string().min(64).max(25_000_000) });

/**
 * POST /api/orders/[id]/photos — pickup condition photo. The assigned field
 * manager (before pickup is completed) or an admin. Shown to QC.
 */
export const POST = api<{ params: { id: string } }>(async (request, { params }) => {
  const user = await requireApiUser(["ADMIN", "FIELD_MANAGER"]);
  const { image } = await body(request, Schema);
  const pickup = await prisma.pickup.findUnique({ where: { orderId: params.id } });
  if (!pickup) throw new HttpError(404, "Order not found.");
  if (user.role === "FIELD_MANAGER" && pickup.assignedToId !== user.id) throw new HttpError(404, "Order not found.");
  if (pickup.photoUrls.length >= 10) throw new HttpError(400, "Maximum 10 photos per order.");
  if (!isCloudinaryConfigured()) throw new HttpError(503, "Photo storage is not configured.");

  const up = await uploadJobPhoto(image, params.id, "before");
  if (!up.ok) throw new HttpError(400, up.error);
  await prisma.$transaction(async (tx) => {
    await tx.pickup.update({ where: { orderId: params.id }, data: { photoUrls: { push: up.data.url } } });
    await logActivity(tx, { orderId: params.id, actor: actorOf(user, request), action: "PHOTO_ADDED" });
  });
  return { url: up.data.url };
});
