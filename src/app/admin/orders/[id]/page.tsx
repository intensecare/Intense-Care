import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, MapPin, MessageCircle } from "lucide-react";
import { orderDetail, activeFieldManagers } from "@/lib/server/queries";
import { prisma } from "@/lib/server/prisma";
import { getSettings } from "@/lib/server/settings";
import { customerLink } from "@/lib/server/customer-link";
import { Badge, Card, CardHeader, PaymentBadge, Row, StatusBadge } from "@/components/ui";
import { Progress } from "@/components/Progress";
import { AssignButton, CustomerLinkCard, EditDetailsButton, EditItemsButton, OrderActions, RecordPaymentButton } from "@/components/admin/OrderControls";
import { availableActions, EDITABLE_STATUSES, STATUS_LABEL } from "@/lib/workflow";
import { displayPhone, formatDateTime, mapsUrl, money, PAYMENT_METHOD_LABEL, UNIT_LABEL, whatsappUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

const TASK_LABEL: Record<string, string> = { PENDING: "Not assigned", ASSIGNED: "Assigned", IN_PROGRESS: "In progress", COMPLETED: "Done", CANCELLED: "Cancelled" };

/** The Order command center: everything about one order on one screen. */
export default async function OrderDetailPage({ params }: { params: { id: string } }) {
  const order = await orderDetail(params.id);
  if (!order) notFound();
  const [fieldManagers, services, settings] = await Promise.all([
    activeFieldManagers(),
    prisma.service.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, unit: true, price: true } }),
    getSettings(),
  ]);
  const balance = Math.max(0, order.total - order.amountPaid);
  const actions = availableActions("ADMIN", order.status).map((t) => ({ to: t.to, label: t.label, requiresReason: t.requiresReason, tone: t.tone }));
  const editable = EDITABLE_STATUSES.includes(order.status);
  const closed = order.status === "DELIVERED" || order.status === "CANCELLED";
  const link = customerLink(order);
  const sentence = (a: string) => a.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  const timeline = [
    ...order.activity.map((a) => ({
      key: a.id,
      at: a.createdAt.getTime(),
      kind: "activity" as const,
      title: a.toStatus ? (a.fromStatus ? `${STATUS_LABEL[a.fromStatus]} → ${STATUS_LABEL[a.toStatus]}` : STATUS_LABEL[a.toStatus]) : sentence(a.action),
      details: a.details,
      meta: `${a.actorName} (${a.actorRole.replace("_", " ").toLowerCase()}) · ${formatDateTime(a.createdAt)}`,
    })),
    ...order.notifications.map((n) => ({
      key: n.id,
      at: n.createdAt.getTime(),
      kind: "message" as const,
      title: `WhatsApp: ${n.event.replace(/_/g, " ").toLowerCase()} — ${n.status === "SENT" ? "sent" : n.status === "SKIPPED" ? "not sent (WhatsApp off)" : "failed"}`,
      details: null,
      meta: `To ${displayPhone(n.recipient)} · ${formatDateTime(n.createdAt)}`,
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <div className="space-y-4">
      <Link href="/admin/orders" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" /> Orders
      </Link>

      {/* Header + next step */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{order.orderNumber}</h1>
              <StatusBadge status={order.status} />
              {order.total > 0 && order.status !== "CANCELLED" && <PaymentBadge total={order.total} paid={order.amountPaid} />}
            </div>
            <p className="mt-1 text-sm text-slate-500">Created {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-900">{money(order.total)}</div>
            {balance > 0 && order.status !== "CANCELLED" && <div className="text-sm font-medium text-amber-700">{money(balance)} due</div>}
          </div>
        </div>
        <div className="mt-4">
          <Progress status={order.status} />
        </div>
        <div className="mt-4 border-t border-slate-100 pt-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">Next step</div>
          <OrderActions
            orderId={order.id}
            orderNumber={order.orderNumber}
            status={order.status}
            actions={actions}
            amountDue={balance}
            fieldManagers={fieldManagers}
            pickupAssigneeId={order.pickup?.assignedToId ?? null}
            deliveryAssigneeId={order.delivery?.assignedToId ?? null}
          />
          {order.status === "CANCELLED" && order.cancelReason && <p className="mt-2 text-sm text-slate-600">Reason: {order.cancelReason}</p>}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Customer */}
        <Card>
          <CardHeader
            title="Customer"
            action={!closed && <EditDetailsButton orderId={order.id} pickupAddress={order.pickupAddress} deliveryAddress={order.deliveryAddress} specialInstructions={order.specialInstructions} />}
          />
          <div className="space-y-3 p-4">
            <div>
              <div className="text-lg font-semibold text-slate-900">{order.customer.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={`tel:+${order.customer.phone}`} className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-medium">
                  <Phone className="h-4 w-4" /> {displayPhone(order.customer.phone)}
                </a>
                <a href={whatsappUrl(order.customer.phone, "")} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-sm font-medium">
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              <Row label="Pickup address">
                <a href={mapsUrl(order.pickupAddress)} target="_blank" rel="noreferrer" className="inline-flex items-start gap-1 text-left hover:underline">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {order.pickupAddress}
                </a>
              </Row>
              {order.deliveryAddress !== order.pickupAddress && <Row label="Delivery address">{order.deliveryAddress}</Row>}
              {order.specialInstructions && <Row label="Instructions">{order.specialInstructions}</Row>}
            </div>
            <div>
              <div className="mb-2 text-sm font-semibold text-slate-700">Customer tracking link</div>
              <CustomerLinkCard orderId={order.id} orderNumber={order.orderNumber} link={link} phone={order.customer.phone} businessName={settings.businessName} />
            </div>
          </div>
        </Card>

        {/* Pickup & delivery */}
        <Card>
          <CardHeader title="Pickup & Delivery" />
          <div className="space-y-4 p-4">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">Pickup</span>
                <Badge tone={order.pickup?.status === "COMPLETED" ? "success" : order.pickup?.status === "ASSIGNED" ? "info" : "neutral"}>
                  {TASK_LABEL[order.pickup?.status ?? "PENDING"]}
                </Badge>
              </div>
              <div className="divide-y divide-slate-100">
                <Row label="Field manager">{order.pickup?.assignedTo?.name ?? "—"}</Row>
                <Row label="Scheduled">{formatDateTime(order.pickup?.scheduledAt)}</Row>
                {order.pickup?.completedAt && <Row label="Picked up">{formatDateTime(order.pickup.completedAt)}</Row>}
                {order.pickup?.notes && <Row label="Note">{order.pickup.notes}</Row>}
              </div>
              {order.pickup && order.pickup.photoUrls.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {order.pickup.photoUrls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer">
                      <img src={u} alt="Pickup photo" className="h-20 w-20 rounded-lg object-cover" />
                    </a>
                  ))}
                </div>
              )}
              {(order.status === "CREATED" || order.status === "PICKUP_ASSIGNED") && order.pickup?.assignedToId && (
                <div className="mt-2">
                  <AssignButton orderId={order.id} kind="pickup" fieldManagers={fieldManagers} currentId={order.pickup.assignedToId} currentScheduledAt={order.pickup.scheduledAt?.toISOString()} label="Reassign pickup" />
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">Delivery</span>
                <Badge tone={order.delivery?.status === "COMPLETED" ? "success" : order.delivery?.assignedToId ? "info" : "neutral"}>
                  {order.delivery ? TASK_LABEL[order.delivery.status] : order.status === "CANCELLED" ? "Cancelled" : "After QC"}
                </Badge>
              </div>
              <div className="divide-y divide-slate-100">
                <Row label="Field manager">{order.delivery?.assignedTo?.name ?? "—"}</Row>
                {order.delivery?.scheduledAt && <Row label="Scheduled">{formatDateTime(order.delivery.scheduledAt)}</Row>}
                {order.delivery?.startedAt && <Row label="Started">{formatDateTime(order.delivery.startedAt)}</Row>}
                {order.delivery?.completedAt && <Row label="Delivered">{formatDateTime(order.delivery.completedAt)}</Row>}
                {order.delivery?.notes && <Row label="Note">{order.delivery.notes}</Row>}
              </div>
              {!["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "CREATED", "PICKUP_ASSIGNED"].includes(order.status) && (
                <div className="mt-2">
                  <AssignButton
                    orderId={order.id}
                    kind="delivery"
                    fieldManagers={fieldManagers}
                    currentId={order.delivery?.assignedToId ?? null}
                    currentScheduledAt={order.delivery?.scheduledAt?.toISOString()}
                    label={order.delivery?.assignedToId ? "Reassign delivery" : "Plan delivery"}
                  />
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader
            title="Items & Services"
            action={
              editable && (
                <EditItemsButton
                  orderId={order.id}
                  services={services}
                  items={order.items.map((i) => ({ serviceId: i.serviceId, itemName: i.itemName, quantity: i.quantity }))}
                  discount={order.discount}
                />
              )
            }
          />
          <div className="p-4">
            {order.items.length === 0 ? (
              <p className="text-sm text-amber-700">No items yet — add them after the pickup count.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {order.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{i.itemName}</div>
                      <div className="text-sm text-slate-500">
                        {i.serviceName} · {i.quantity} {UNIT_LABEL[i.unit]} × {money(i.unitPrice)}
                      </div>
                    </div>
                    <div className="shrink-0 font-semibold text-slate-900">{money(i.lineTotal)}</div>
                  </li>
                ))}
              </ul>
            )}
            {!editable && !closed && <p className="mt-2 text-xs text-slate-400">Items are locked once the order is in quality check.</p>}
          </div>
        </Card>

        {/* Payment */}
        <Card>
          <CardHeader title="Payment" action={order.status !== "CANCELLED" && balance > 0 && <RecordPaymentButton orderId={order.id} balance={balance} />} />
          <div className="p-4">
            <div className="divide-y divide-slate-100">
              <Row label="Subtotal">{money(order.subtotal)}</Row>
              {order.discount > 0 && <Row label="Discount">− {money(order.discount)}</Row>}
              {order.tax > 0 && <Row label={`Tax (${settings.taxPercent}%)`}>{money(order.tax)}</Row>}
              <Row label="Total">{money(order.total)}</Row>
              <Row label="Paid">{money(order.amountPaid)}</Row>
              <Row label="Balance">{money(balance)}</Row>
            </div>
            {order.payments.length > 0 && (
              <ul className="mt-3 space-y-2">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      {PAYMENT_METHOD_LABEL[p.method]}
                      {p.reference ? ` · ${p.reference}` : ""} · {formatDateTime(p.createdAt)}
                      {p.receivedBy ? ` · ${p.receivedBy.name}` : ""}
                    </span>
                    <span className="font-semibold">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* QC */}
        <Card>
          <CardHeader title="Quality Check" />
          <div className="p-4">
            {order.qcRecords.length === 0 ? (
              <p className="text-sm text-slate-500">{order.status === "QC_PENDING" ? "Waiting for QC inspection." : "Not inspected yet."}</p>
            ) : (
              <ul className="space-y-2">
                {order.qcRecords.map((q) => (
                  <li key={q.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge tone={q.result === "PASSED" ? "success" : "danger"}>{q.result === "PASSED" ? "Passed" : q.result === "FAILED" ? "Failed" : "Needs rework"}</Badge>
                      <span className="text-xs text-slate-500">
                        {q.inspector.name} · {formatDateTime(q.createdAt)}
                      </span>
                    </div>
                    {q.reason && <p className="mt-1.5 text-sm text-slate-700">{q.reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        {/* Activity */}
        <Card>
          <CardHeader title="Activity" />
          <ol className="max-h-[420px] space-y-3 overflow-y-auto p-4">
            {timeline.map((t) => (
              <li key={t.key} className="flex gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${t.kind === "message" ? "bg-sky-400" : "bg-brand-500"}`} />
                <div className="min-w-0 text-sm">
                  <div className="text-slate-900">{t.title}</div>
                  {t.details && <div className="text-slate-600 break-words">{t.details}</div>}
                  <div className="text-xs text-slate-400">{t.meta}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
