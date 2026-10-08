import crypto from "crypto";
import { Prisma, type OrderStatus, type PaymentMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./http";
import { getSettings } from "./settings";
import { notifyOrder, type NotifyEvent } from "./notify";
import { AUTO_ADVANCE, EDITABLE_STATUSES, STATUS_LABEL, findTransition, type Actor } from "@/lib/workflow";
import { computeTotals, lineTotal, paymentStatusFor } from "@/lib/pricing";
import { normalizePhone, money } from "@/lib/format";

/**
 * The order engine. Every change to an order goes through this module:
 *   - transitions are validated against the workflow table (src/lib/workflow.ts),
 *   - field managers may only act on pickups/deliveries assigned to them,
 *   - each status write is a compare-and-set (`where status = from`) inside a
 *     transaction, so double taps and races cannot apply a step twice,
 *   - every change writes an ActivityLog row,
 *   - automation runs in the same transaction (picked up → processing,
 *     QC passed → ready → delivery assigned),
 *   - WhatsApp notifications go out after the commit.
 */

type Tx = Prisma.TransactionClient;

export interface ActorCtx {
  id: string | null;
  name: string;
  role: Actor;
  ip?: string | null;
}

const SYSTEM: ActorCtx = { id: null, name: "System", role: "SYSTEM" };

export async function logActivity(
  tx: Tx,
  a: { orderId?: string | null; actor: ActorCtx; action: string; from?: OrderStatus | null; to?: OrderStatus | null; details?: string | null }
) {
  await tx.activityLog.create({
    data: {
      orderId: a.orderId ?? null,
      actorId: a.actor.id,
      actorName: a.actor.name,
      actorRole: a.actor.role,
      action: a.action,
      fromStatus: a.from ?? null,
      toStatus: a.to ?? null,
      details: a.details?.slice(0, 1000) ?? null,
      ipAddress: a.actor.ip ?? null,
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Field manager assignment                                                   */
/* -------------------------------------------------------------------------- */

async function activeFieldManager(tx: Tx, id: string) {
  const u = await tx.user.findUnique({ where: { id } });
  if (!u || !u.active || u.role !== "FIELD_MANAGER") throw new HttpError(400, "Choose an active field manager.");
  return u;
}

/** Least-busy active field manager (open pickups + deliveries), or null. */
async function leastBusyFieldManager(tx: Tx, prefer?: string | null): Promise<string | null> {
  const fms = await tx.user.findMany({
    where: { role: "FIELD_MANAGER", active: true },
    select: {
      id: true,
      _count: {
        select: {
          pickups: { where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] } } },
          deliveries: { where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  if (fms.length === 0) return null;
  if (prefer && fms.some((f) => f.id === prefer)) return prefer;
  fms.sort((a, b) => a._count.pickups + a._count.deliveries - (b._count.pickups + b._count.deliveries));
  return fms[0].id;
}

/* -------------------------------------------------------------------------- */
/* One status step (compare-and-set)                                          */
/* -------------------------------------------------------------------------- */

async function applyStep(
  tx: Tx,
  orderId: string,
  from: OrderStatus,
  to: OrderStatus,
  actor: ActorCtx,
  extra: { reason?: string | null; notes?: string | null } = {}
) {
  const now = new Date();
  const data: Prisma.OrderUpdateManyMutationInput = { status: to };
  if (to === "READY") data.readyAt = now;
  if (to === "DELIVERED") data.deliveredAt = now;
  if (to === "CANCELLED") {
    data.cancelledAt = now;
    data.cancelReason = extra.reason ?? null;
  }
  const res = await tx.order.updateMany({ where: { id: orderId, status: from }, data });
  if (res.count !== 1) throw new HttpError(409, "This order was just updated. Refresh and try again.");

  switch (to) {
    case "PICKED_UP":
      await tx.pickup.update({
        where: { orderId },
        data: { status: "COMPLETED", completedAt: now, ...(extra.notes ? { notes: extra.notes } : {}) },
      });
      break;
    case "OUT_FOR_DELIVERY": {
      const d = await tx.delivery.findUnique({ where: { orderId } });
      if (!d?.assignedToId) throw new HttpError(409, "Assign a field manager for delivery first.");
      await tx.delivery.update({ where: { orderId }, data: { status: "IN_PROGRESS", startedAt: now } });
      break;
    }
    case "DELIVERED":
      await tx.delivery.update({
        where: { orderId },
        data: { status: "COMPLETED", completedAt: now, ...(extra.notes ? { notes: extra.notes } : {}) },
      });
      break;
    case "QC_PASSED":
    case "QC_FAILED":
    case "REWORK":
      if (from === "QC_PENDING") {
        if (!actor.id) throw new HttpError(400, "QC decisions need an inspector.");
        await tx.qCRecord.create({
          data: {
            orderId,
            inspectorId: actor.id,
            result: to === "QC_PASSED" ? "PASSED" : to === "QC_FAILED" ? "FAILED" : "REWORK",
            reason: extra.reason ?? null,
          },
        });
      }
      break;
    case "CANCELLED":
      await tx.pickup.updateMany({ where: { orderId, status: { not: "COMPLETED" } }, data: { status: "CANCELLED" } });
      await tx.delivery.updateMany({ where: { orderId, status: { not: "COMPLETED" } }, data: { status: "CANCELLED" } });
      break;
  }

  await logActivity(tx, {
    orderId,
    actor,
    action: "STATUS_CHANGED",
    from,
    to,
    details: [extra.reason, extra.notes].filter(Boolean).join(" — ") || null,
  });
}

/** Creates/assigns the delivery task once an order is ready. */
async function ensureDeliveryAssigned(tx: Tx, orderId: string, actor: ActorCtx): Promise<boolean> {
  const [settings, pickup, delivery] = await Promise.all([
    getSettings(),
    tx.pickup.findUnique({ where: { orderId } }),
    tx.delivery.findUnique({ where: { orderId } }),
  ]);
  if (delivery?.assignedToId) return false;
  const fm = settings.autoAssign ? await leastBusyFieldManager(tx, pickup?.assignedToId) : null;
  await tx.delivery.upsert({
    where: { orderId },
    create: { orderId, assignedToId: fm, status: fm ? "ASSIGNED" : "PENDING" },
    update: { assignedToId: fm, status: fm ? "ASSIGNED" : "PENDING" },
  });
  if (fm) await logActivity(tx, { orderId, actor, action: "DELIVERY_ASSIGNED", details: "Auto-assigned" });
  return Boolean(fm);
}

const CUSTOMER_EVENT: Partial<Record<OrderStatus, NotifyEvent>> = {
  PICKUP_ASSIGNED: "PICKUP_ASSIGNED",
  PICKED_UP: "PICKED_UP",
  READY: "READY",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
};

/* -------------------------------------------------------------------------- */
/* Transitions                                                                */
/* -------------------------------------------------------------------------- */

export interface TransitionInput {
  orderId: string;
  to: OrderStatus;
  actor: ActorCtx;
  reason?: string;
  notes?: string;
  /** Cash/UPI collected at the door when marking DELIVERED. */
  payment?: { amount: number; method: PaymentMethod; reference?: string; idempotencyKey?: string };
}

export async function transitionOrder(input: TransitionInput) {
  const { actor, to } = input;
  const order = await prisma.order.findUnique({ where: { id: input.orderId }, include: { pickup: true, delivery: true } });
  if (!order) throw new HttpError(404, "Order not found.");

  // Field managers only ever see their own tasks — anything else is "not found".
  if (actor.role === "FIELD_MANAGER") {
    const mine =
      to === "PICKED_UP"
        ? order.pickup?.assignedToId === actor.id
        : to === "OUT_FOR_DELIVERY" || to === "DELIVERED"
        ? order.delivery?.assignedToId === actor.id
        : false;
    if (!mine) throw new HttpError(404, "Order not found.");
  }

  const from = order.status;
  if (from === to) throw new HttpError(409, `Order is already ${STATUS_LABEL[to]}.`);
  const t = findTransition(from, to);
  if (!t) throw new HttpError(409, `An order that is ${STATUS_LABEL[from]} cannot move to ${STATUS_LABEL[to]}.`);
  if (!t.actors.includes(actor.role)) throw new HttpError(403, "You are not allowed to make this change.");
  const reason = input.reason?.trim();
  if (t.requiresReason && !reason) throw new HttpError(400, "Please give a reason.");
  if (to === "PICKUP_ASSIGNED") throw new HttpError(400, "Use pickup assignment to choose a field manager.");

  const events: NotifyEvent[] = [];
  await prisma.$transaction(async (tx) => {
    await applyStep(tx, order.id, from, to, actor, { reason, notes: input.notes?.trim() });
    const entered: OrderStatus[] = [to];

    if (to === "DELIVERED" && input.payment && input.payment.amount > 0) {
      await recordPaymentTx(tx, { orderId: order.id, ...input.payment, actor });
    }

    let cur: OrderStatus = to;
    while (AUTO_ADVANCE[cur]) {
      const next: OrderStatus = AUTO_ADVANCE[cur]!;
      await applyStep(tx, order.id, cur, next, SYSTEM);
      entered.push(next);
      cur = next;
    }
    if (entered.includes("READY") && (await ensureDeliveryAssigned(tx, order.id, SYSTEM))) events.push("FM_DELIVERY");

    for (const s of entered) {
      const e = CUSTOMER_EVENT[s];
      if (e) events.push(e);
    }
  });

  await notifyOrder(order.id, events);
  return prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { id: true, status: true } });
}

/* -------------------------------------------------------------------------- */
/* Assignment                                                                 */
/* -------------------------------------------------------------------------- */

export async function assignTask(input: {
  orderId: string;
  kind: "pickup" | "delivery";
  userId: string;
  scheduledAt?: Date | null;
  actor: ActorCtx;
}) {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) throw new HttpError(404, "Order not found.");
  const events: NotifyEvent[] = [];

  await prisma.$transaction(async (tx) => {
    const fm = await activeFieldManager(tx, input.userId);
    if (input.kind === "pickup") {
      if (order.status !== "CREATED" && order.status !== "PICKUP_ASSIGNED") {
        throw new HttpError(409, "Pickup can only be (re)assigned before it is picked up.");
      }
      await tx.pickup.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, assignedToId: fm.id, status: "ASSIGNED", scheduledAt: input.scheduledAt ?? null },
        update: { assignedToId: fm.id, status: "ASSIGNED", ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}) },
      });
      await logActivity(tx, { orderId: order.id, actor: input.actor, action: "PICKUP_ASSIGNED", details: `Assigned to ${fm.name}` });
      if (order.status === "CREATED") {
        await applyStep(tx, order.id, "CREATED", "PICKUP_ASSIGNED", input.actor);
        events.push("PICKUP_ASSIGNED");
      }
      events.push("FM_PICKUP");
    } else {
      if (["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].includes(order.status)) {
        throw new HttpError(409, "Delivery can only be (re)assigned before it starts.");
      }
      await tx.delivery.upsert({
        where: { orderId: order.id },
        create: { orderId: order.id, assignedToId: fm.id, status: "ASSIGNED", scheduledAt: input.scheduledAt ?? null },
        update: { assignedToId: fm.id, status: "ASSIGNED", ...(input.scheduledAt !== undefined ? { scheduledAt: input.scheduledAt } : {}) },
      });
      await logActivity(tx, { orderId: order.id, actor: input.actor, action: "DELIVERY_ASSIGNED", details: `Assigned to ${fm.name}` });
      if (order.status === "READY") events.push("FM_DELIVERY");
    }
  });

  await notifyOrder(order.id, events);
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                   */
/* -------------------------------------------------------------------------- */

interface PaymentInput {
  orderId: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  idempotencyKey?: string;
  actor: ActorCtx;
}

async function recordPaymentTx(tx: Tx, p: PaymentInput) {
  if (p.idempotencyKey) {
    const existing = await tx.payment.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
    if (existing) return existing;
  }
  const order = await tx.order.findUnique({ where: { id: p.orderId } });
  if (!order) throw new HttpError(404, "Order not found.");
  if (order.status === "CANCELLED") throw new HttpError(409, "This order is cancelled.");
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new HttpError(400, "Enter a valid amount.");
  const balance = order.total - order.amountPaid;
  if (p.amount > balance) throw new HttpError(400, `Amount is more than the balance due (${money(balance)}).`);

  const payment = await tx.payment.create({
    data: {
      orderId: order.id,
      amount: p.amount,
      method: p.method,
      reference: p.reference?.trim() || null,
      idempotencyKey: p.idempotencyKey ?? null,
      receivedById: p.actor.id,
    },
  });
  const amountPaid = order.amountPaid + p.amount;
  await tx.order.update({ where: { id: order.id }, data: { amountPaid, paymentStatus: paymentStatusFor(order.total, amountPaid) } });
  await logActivity(tx, {
    orderId: order.id,
    actor: p.actor,
    action: "PAYMENT_RECORDED",
    details: `${money(p.amount)} by ${p.method}${p.reference ? ` (ref ${p.reference})` : ""}`,
  });
  return payment;
}

export async function recordPayment(p: PaymentInput) {
  const payment = await prisma.$transaction((tx) => recordPaymentTx(tx, p));
  await notifyOrder(p.orderId, ["PAYMENT_RECEIVED"]);
  return payment;
}

/* -------------------------------------------------------------------------- */
/* Create / edit                                                              */
/* -------------------------------------------------------------------------- */

export interface ItemInput {
  serviceId: string;
  itemName: string;
  quantity: number;
}

async function priceItems(tx: Tx, items: ItemInput[]) {
  if (items.length === 0) return [];
  const services = await tx.service.findMany({ where: { id: { in: items.map((i) => i.serviceId) } } });
  const byId = new Map(services.map((s) => [s.id, s]));
  return items.map((i) => {
    const s = byId.get(i.serviceId);
    if (!s) throw new HttpError(400, "One of the services no longer exists.");
    if (!s.active) throw new HttpError(400, `${s.name} is not active.`);
    return {
      serviceId: s.id,
      serviceName: s.name,
      unit: s.unit,
      unitPrice: s.price,
      itemName: i.itemName.trim() || s.name,
      quantity: i.quantity,
      lineTotal: lineTotal({ quantity: i.quantity, unitPrice: s.price }),
    };
  });
}

export interface CreateOrderInput {
  customerId?: string;
  customer?: { name: string; phone: string; address: string; email?: string };
  items: ItemInput[];
  pickupAddress?: string;
  deliveryAddress?: string;
  specialInstructions?: string;
  pickupAt?: Date | null;
  assignToId?: string | null;
  discount: number;
  actor: ActorCtx;
}

export async function createOrder(input: CreateOrderInput): Promise<{ id: string; orderNumber: string }> {
  const settings = await getSettings();
  const events: NotifyEvent[] = ["ORDER_CREATED"];

  const created = await prisma.$transaction(async (tx) => {
    let customer;
    if (input.customerId) {
      customer = await tx.customer.findUnique({ where: { id: input.customerId } });
      if (!customer) throw new HttpError(404, "Customer not found.");
    } else if (input.customer) {
      const phone = normalizePhone(input.customer.phone);
      if (phone.length < 10) throw new HttpError(400, "Enter a valid phone number.");
      customer =
        (await tx.customer.findUnique({ where: { phone } })) ??
        (await tx.customer.create({
          data: { name: input.customer.name.trim(), phone, address: input.customer.address.trim(), email: input.customer.email?.trim() || null },
        }));
    } else {
      throw new HttpError(400, "Choose or add a customer.");
    }

    const lines = await priceItems(tx, input.items);
    const totals = computeTotals(lines, input.discount, settings.taxPercent);
    const pickupAddress = input.pickupAddress?.trim() || customer.address;

    const order = await tx.order.create({
      data: {
        orderNumber: `TMP-${crypto.randomUUID()}`,
        customerId: customer.id,
        pickupAddress,
        deliveryAddress: input.deliveryAddress?.trim() || pickupAddress,
        specialInstructions: input.specialInstructions?.trim() || null,
        ...totals,
        paymentStatus: paymentStatusFor(totals.total, 0),
        createdById: input.actor.id,
        items: { create: lines },
        pickup: { create: { status: "PENDING", scheduledAt: input.pickupAt ?? null } },
      },
    });
    const orderNumber = `${settings.orderPrefix || "AC"}${1000 + order.seq}`;
    await tx.order.update({ where: { id: order.id }, data: { orderNumber } });
    await logActivity(tx, { orderId: order.id, actor: input.actor, action: "ORDER_CREATED", to: "CREATED", details: `${lines.length} item line(s), total ${money(totals.total)}` });

    // Automation: order created → pickup assigned.
    const fmId = input.assignToId
      ? (await activeFieldManager(tx, input.assignToId)).id
      : settings.autoAssign
      ? await leastBusyFieldManager(tx)
      : null;
    if (fmId) {
      await tx.pickup.update({ where: { orderId: order.id }, data: { assignedToId: fmId, status: "ASSIGNED" } });
      await applyStep(tx, order.id, "CREATED", "PICKUP_ASSIGNED", input.assignToId ? input.actor : SYSTEM);
      events.push("PICKUP_ASSIGNED", "FM_PICKUP");
    }
    return { id: order.id, orderNumber };
  });

  await notifyOrder(created.id, events);
  return created;
}

export interface UpdateOrderInput {
  orderId: string;
  items?: ItemInput[];
  discount?: number;
  pickupAddress?: string;
  deliveryAddress?: string;
  specialInstructions?: string | null;
  actor: ActorCtx;
}

export async function updateOrder(input: UpdateOrderInput) {
  const settings = await getSettings();
  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { items: true } });
    if (!order) throw new HttpError(404, "Order not found.");
    if (order.status === "DELIVERED" || order.status === "CANCELLED") throw new HttpError(409, "Closed orders cannot be edited.");

    const changes: string[] = [];
    const data: Prisma.OrderUpdateInput = {};
    if (input.pickupAddress !== undefined && input.pickupAddress.trim() !== order.pickupAddress) {
      data.pickupAddress = input.pickupAddress.trim();
      changes.push("pickup address");
    }
    if (input.deliveryAddress !== undefined && input.deliveryAddress.trim() !== order.deliveryAddress) {
      data.deliveryAddress = input.deliveryAddress.trim();
      changes.push("delivery address");
    }
    if (input.specialInstructions !== undefined && (input.specialInstructions?.trim() || null) !== order.specialInstructions) {
      data.specialInstructions = input.specialInstructions?.trim() || null;
      changes.push("instructions");
    }

    if (input.items !== undefined || input.discount !== undefined) {
      if (!EDITABLE_STATUSES.includes(order.status)) {
        throw new HttpError(409, "Items and prices are locked once the order is in quality check.");
      }
      let lines = order.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice }));
      if (input.items !== undefined) {
        const priced = await priceItems(tx, input.items);
        await tx.orderItem.deleteMany({ where: { orderId: order.id } });
        if (priced.length) await tx.orderItem.createMany({ data: priced.map((p) => ({ ...p, orderId: order.id })) });
        lines = priced;
        changes.push(`items (${priced.length} lines)`);
      }
      const totals = computeTotals(lines, input.discount ?? order.discount, settings.taxPercent);
      if (totals.total < order.amountPaid) throw new HttpError(409, "The new total is lower than what the customer already paid.");
      Object.assign(data, totals, { paymentStatus: paymentStatusFor(totals.total, order.amountPaid) });
      if (input.discount !== undefined && totals.discount !== order.discount) changes.push(`discount ${money(totals.discount)}`);
    }

    if (changes.length === 0) return;
    await tx.order.update({ where: { id: order.id }, data });
    await logActivity(tx, { orderId: order.id, actor: input.actor, action: "ORDER_UPDATED", details: `Updated ${changes.join(", ")}` });
  });
}

/** Revokes the customer's link and issues a new one (bumps linkVersion). */
export async function rotateCustomerLink(orderId: string, actor: ActorCtx) {
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { linkVersion: { increment: 1 } } });
    await logActivity(tx, { orderId, actor, action: "CUSTOMER_LINK_RESET", details: "Previous customer link revoked" });
  });
}
