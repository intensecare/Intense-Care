import { z } from "zod";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { saveSettings } from "@/lib/server/settings";
import { prisma } from "@/lib/server/prisma";

const Schema = z.object({
  businessName: z.string().trim().min(1).max(80).optional(),
  supportPhone: z.string().trim().max(20).optional(),
  supportWhatsApp: z.string().trim().max(20).optional(),
  supportEmail: z.string().trim().max(200).optional(),
  businessAddress: z.string().trim().max(300).optional(),
  orderPrefix: z.string().trim().regex(/^[A-Z]{1,4}$/, "Use 1–4 capital letters").optional(),
  taxPercent: z.number().min(0).max(50).optional(),
  upiId: z.string().trim().max(80).optional(),
  autoAssign: z.boolean().optional(),
  notifyCustomers: z.boolean().optional(),
});

/** PATCH /api/settings — admin only. */
export const PATCH = api(async (request) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  const saved = await saveSettings(d);
  const a = actorOf(user, request);
  await prisma.activityLog.create({
    data: { actorId: a.id, actorName: a.name, actorRole: a.role, action: "SETTINGS_UPDATED", details: Object.keys(d).join(", "), ipAddress: a.ip ?? null },
  });
  return saved;
});
