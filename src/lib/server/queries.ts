import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { dayRange } from "./time";
import { STATUS_GROUPS, type StatusGroup } from "@/lib/workflow";

/** Read models for server-rendered pages. Every query is already role-scoped by its caller. */

export async function adminDashboard() {
  const today = dayRange();
  const [byStatus, todayOrders, deliveredToday, unpaid] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.order.count({ where: { createdAt: { gte: today.start, lt: today.end } } }),
    prisma.order.count({ where: { status: "DELIVERED", deliveredAt: { gte: today.start, lt: today.end } } }),
    prisma.order.findMany({
      where: { status: { not: "CANCELLED" }, total: { gt: 0 } },
      select: { total: true, amountPaid: true },
    }),
  ]);
  const count = (statuses: readonly OrderStatus[]) =>
    byStatus.filter((r) => statuses.includes(r.status)).reduce((a, r) => a + r._count._all, 0);
  const pending = unpaid.filter((o) => o.amountPaid < o.total);
  return {
    todayOrders,
    pendingPickups: count(STATUS_GROUPS.pickup),
    processing: count(STATUS_GROUPS.processing),
    qcPending: count(STATUS_GROUPS.qc),
    qcFailed: count(STATUS_GROUPS.qcFailed),
    ready: count(STATUS_GROUPS.ready),
    outForDelivery: count(STATUS_GROUPS.delivery),
    deliveredToday,
    pendingPayments: pending.length,
    pendingAmount: pending.reduce((a, o) => a + (o.total - o.amountPaid), 0),
  };
}

const LIST_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  total: true,
  amountPaid: true,
  createdAt: true,
  customer: { select: { name: true, phone: true } },
  pickup: { select: { scheduledAt: true, assignedTo: { select: { name: true } } } },
  delivery: { select: { assignedTo: { select: { name: true } } } },
  _count: { select: { items: true } },
} satisfies Prisma.OrderSelect;

export type OrderListRow = Prisma.OrderGetPayload<{ select: typeof LIST_SELECT }>;

/** Orders that need an admin's hands right now — each with the reason. */
export async function attentionOrders(): Promise<{ order: OrderListRow; reason: string }[]> {
  const [unassignedPickups, qcFailed, rework, readyNoDriver, unpaidDelivered] = await Promise.all([
    prisma.order.findMany({ where: { status: "CREATED" }, select: LIST_SELECT, orderBy: { createdAt: "asc" }, take: 10 }),
    prisma.order.findMany({ where: { status: "QC_FAILED" }, select: LIST_SELECT, orderBy: { updatedAt: "asc" }, take: 10 }),
    prisma.order.findMany({ where: { status: "REWORK" }, select: LIST_SELECT, orderBy: { updatedAt: "asc" }, take: 10 }),
    prisma.order.findMany({
      where: { status: "READY", OR: [{ delivery: null }, { delivery: { assignedToId: null } }] },
      select: LIST_SELECT,
      take: 10,
    }),
    prisma.order.findMany({ where: { status: "DELIVERED", paymentStatus: { not: "PAID" }, total: { gt: 0 } }, select: LIST_SELECT, orderBy: { deliveredAt: "asc" }, take: 10 }),
  ]);
  const processing = await prisma.order.findMany({ where: { status: "PROCESSING" }, select: LIST_SELECT, orderBy: { updatedAt: "asc" }, take: 10 });
  return [
    ...unassignedPickups.map((order) => ({ order, reason: "Assign a pickup" })),
    ...qcFailed.map((order) => ({ order, reason: "QC failed — start rework" })),
    ...rework.map((order) => ({ order, reason: "In rework — send back to QC when done" })),
    ...readyNoDriver.map((order) => ({ order, reason: "Ready — assign delivery" })),
    ...processing.map((order) => ({ order, reason: "Processing — send to QC when done" })),
    ...unpaidDelivered.map((order) => ({ order, reason: "Delivered — payment pending" })),
  ];
}

export async function listOrders(opts: { group?: string; q?: string; customerId?: string; page?: number }) {
  const where: Prisma.OrderWhereInput = {};
  if (opts.group && opts.group in STATUS_GROUPS) where.status = { in: [...STATUS_GROUPS[opts.group as StatusGroup]] };
  if (opts.group === "unpaid") Object.assign(where, { status: { not: "CANCELLED" }, paymentStatus: { not: "PAID" }, total: { gt: 0 } });
  if (opts.customerId) where.customerId = opts.customerId;
  const q = opts.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { orderNumber: { contains: q.toUpperCase() } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 4 ? [{ customer: { phone: { contains: digits } } }] : []),
    ];
  }
  const page = Math.max(1, opts.page ?? 1);
  const take = 30;
  const [rows, total] = await Promise.all([
    prisma.order.findMany({ where, select: LIST_SELECT, orderBy: { createdAt: "desc" }, skip: (page - 1) * take, take }),
    prisma.order.count({ where }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / take)) };
}

export async function orderDetail(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      customer: true,
      items: { orderBy: { id: "asc" } },
      pickup: { include: { assignedTo: { select: { id: true, name: true, phone: true } } } },
      delivery: { include: { assignedTo: { select: { id: true, name: true, phone: true } } } },
      qcRecords: { orderBy: { createdAt: "desc" }, include: { inspector: { select: { name: true } } } },
      payments: { orderBy: { createdAt: "desc" }, include: { receivedBy: { select: { name: true } } } },
      activity: { orderBy: { createdAt: "desc" }, take: 100 },
      notifications: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
}

export type OrderDetail = NonNullable<Awaited<ReturnType<typeof orderDetail>>>;

export async function activeFieldManagers() {
  return prisma.user.findMany({ where: { role: "FIELD_MANAGER", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/* -------------------------------------------------------------------------- */
/* Field manager                                                              */
/* -------------------------------------------------------------------------- */

const TASK_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  pickupAddress: true,
  deliveryAddress: true,
  specialInstructions: true,
  total: true,
  amountPaid: true,
  customer: { select: { name: true, phone: true } },
  items: { select: { itemName: true, serviceName: true, quantity: true, unit: true } },
} satisfies Prisma.OrderSelect;

export async function fieldTasks(userId: string) {
  const today = dayRange();
  const [pickups, deliveries] = await Promise.all([
    prisma.pickup.findMany({
      where: {
        assignedToId: userId,
        OR: [{ status: "ASSIGNED", order: { status: "PICKUP_ASSIGNED" } }, { status: "COMPLETED", completedAt: { gte: today.start, lt: today.end } }],
      },
      include: { order: { select: TASK_ORDER_SELECT } },
      orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
    prisma.delivery.findMany({
      where: {
        assignedToId: userId,
        OR: [
          { status: { in: ["ASSIGNED", "IN_PROGRESS"] }, order: { status: { in: ["READY", "OUT_FOR_DELIVERY"] } } },
          { status: "COMPLETED", completedAt: { gte: today.start, lt: today.end } },
        ],
      },
      include: { order: { select: TASK_ORDER_SELECT } },
      orderBy: [{ scheduledAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    }),
  ]);
  return { pickups, deliveries, today };
}

export type FieldPickup = Awaited<ReturnType<typeof fieldTasks>>["pickups"][number];
export type FieldDelivery = Awaited<ReturnType<typeof fieldTasks>>["deliveries"][number];

/* -------------------------------------------------------------------------- */
/* QC                                                                         */
/* -------------------------------------------------------------------------- */

const QC_ORDER_INCLUDE = {
  customer: { select: { name: true } },
  items: { select: { itemName: true, serviceName: true, quantity: true, unit: true } },
  pickup: { select: { photoUrls: true, notes: true } },
  qcRecords: { orderBy: { createdAt: "desc" as const }, take: 3, include: { inspector: { select: { name: true } } } },
} satisfies Prisma.OrderInclude;

export async function qcOrders(statuses: OrderStatus[]) {
  return prisma.order.findMany({ where: { status: { in: statuses } }, include: QC_ORDER_INCLUDE, orderBy: { updatedAt: "asc" }, take: 100 });
}

export type QcOrder = Awaited<ReturnType<typeof qcOrders>>[number];

export async function qcHistory(result: "PASSED" | "FAILED") {
  return prisma.qCRecord.findMany({
    where: { result: result === "FAILED" ? { in: ["FAILED", "REWORK"] } : "PASSED" },
    include: {
      inspector: { select: { name: true } },
      order: { select: { orderNumber: true, status: true, customer: { select: { name: true } }, _count: { select: { items: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
}
