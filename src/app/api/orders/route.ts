import { z } from "zod";
import { api, body } from "@/lib/server/http";
import { requireApiUser, actorOf } from "@/lib/server/auth";
import { createOrder } from "@/lib/server/orders";

const Item = z.object({
  serviceId: z.string().min(1).max(64),
  itemName: z.string().max(120).default(""),
  quantity: z.number().positive("Quantity must be more than 0").max(10000),
});

const Schema = z
  .object({
    customerId: z.string().max(64).optional(),
    customer: z
      .object({
        name: z.string().trim().min(2, "Customer name is required").max(120),
        phone: z.string().trim().min(10, "Enter a valid phone number").max(20),
        address: z.string().trim().min(5, "Customer address is required").max(500),
        email: z.string().max(200).optional(),
      })
      .optional(),
    items: z.array(Item).max(100).default([]),
    pickupAddress: z.string().max(500).optional(),
    deliveryAddress: z.string().max(500).optional(),
    specialInstructions: z.string().max(1000).optional(),
    pickupAt: z.string().datetime({ offset: true }).optional().nullable(),
    assignToId: z.string().max(64).optional().nullable(),
    discount: z.number().int().min(0).max(100000000).default(0),
  })
  .refine((d) => d.customerId || d.customer, { message: "Choose or add a customer" });

/** POST /api/orders — admin creates an order (pickup is auto-assigned). */
export const POST = api(async (request) => {
  const user = await requireApiUser(["ADMIN"]);
  const d = await body(request, Schema);
  return createOrder({
    ...d,
    pickupAt: d.pickupAt ? new Date(d.pickupAt) : null,
    actor: actorOf(user, request),
  });
});
