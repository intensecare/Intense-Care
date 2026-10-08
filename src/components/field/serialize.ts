import type { FieldDelivery, FieldPickup } from "@/lib/server/queries";

/** Plain props for client cards (Dates → ISO strings). */
export function pickupProps(p: FieldPickup) {
  return { order: p.order, scheduledAt: p.scheduledAt?.toISOString() ?? null, done: p.status === "COMPLETED" };
}

export function deliveryProps(d: FieldDelivery) {
  return { order: d.order, scheduledAt: d.scheduledAt?.toISOString() ?? null, done: d.status === "COMPLETED" };
}
