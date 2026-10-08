import { formatDateTime } from "@/lib/format";
import type { QcCardOrder } from "./QcCard";

/** Server-side: QC query row → plain props for the client QcCard. */
export function toQcCard(o: {
  id: string;
  orderNumber: string;
  status: string;
  specialInstructions: string | null;
  customer: { name: string };
  items: QcCardOrder["items"];
  pickup: { photoUrls: string[]; notes: string | null } | null;
  qcRecords: { result: string; reason: string | null; createdAt: Date; inspector: { name: string } }[];
}): QcCardOrder {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    customerName: o.customer.name,
    specialInstructions: o.specialInstructions,
    pickupNote: o.pickup?.notes ?? null,
    photoUrls: o.pickup?.photoUrls ?? [],
    items: o.items,
    history: o.qcRecords.filter((q) => q.result !== "PASSED").map((q) => ({ result: q.result, reason: q.reason, inspector: q.inspector.name, at: formatDateTime(q.createdAt) })),
  };
}
