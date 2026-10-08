import { headers } from "next/headers";
import { Phone, MessageCircle, Mail, CreditCard } from "lucide-react";
import { prisma } from "@/lib/server/prisma";
import { getSettings } from "@/lib/server/settings";
import { verifyCustomerKey } from "@/lib/server/customer-link";
import { rateLimit } from "@/lib/server/rate-limit";
import { clientIp } from "@/lib/server/http";
import { Badge, Card, Row } from "@/components/ui";
import { Progress } from "@/components/Progress";
import { AutoRefresh } from "@/components/AutoRefresh";
import { CUSTOMER_STEPS, customerStatusLines, customerStepIndex, type OrderStatus } from "@/lib/workflow";
import { displayPhone, formatDate, formatDateTime, money, PAYMENT_METHOD_LABEL, UNIT_LABEL, whatsappUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

function Invalid({ message }: { message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 text-center">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Link not available</h1>
        <p className="mt-2 text-slate-600">{message}</p>
      </div>
    </div>
  );
}

/**
 * CUSTOMER — "Where is my order?"  /customer/order/AC1024?k=<key>
 * Read-only, no login. The key is an HMAC bound to this order's id, so
 * changing the order number in the URL never opens someone else's order.
 */
export default async function CustomerOrderPage({ params, searchParams }: { params: { orderNumber: string }; searchParams: { k?: string } }) {
  if (!rateLimit(`customer:${clientIp(headers())}`, 60, 60 * 1000)) {
    return <Invalid message="Too many requests. Please wait a minute and try again." />;
  }
  const orderNumber = decodeURIComponent(params.orderNumber).toUpperCase().slice(0, 20);
  const order = await prisma.order.findUnique({
    where: { orderNumber },
    include: {
      customer: { select: { name: true } },
      items: { orderBy: { id: "asc" } },
      pickup: { select: { scheduledAt: true, completedAt: true } },
      delivery: { select: { scheduledAt: true, startedAt: true, completedAt: true } },
      payments: { orderBy: { createdAt: "desc" }, select: { id: true, amount: true, method: true, createdAt: true } },
      activity: { where: { toStatus: { not: null } }, orderBy: { createdAt: "asc" }, select: { toStatus: true, createdAt: true } },
    },
  });
  // Same answer for "no such order" and "wrong key" — nothing to enumerate.
  if (!order || !searchParams.k || !verifyCustomerKey(order.id, order.linkVersion, searchParams.k)) {
    return <Invalid message="This order link is not valid or has been replaced. Please use the latest link we sent you, or contact us." />;
  }
  const settings = await getSettings();

  const status = order.status as OrderStatus;
  const lines = customerStatusLines(status);
  const balance = Math.max(0, order.total - order.amountPaid);
  const firstAt = (s: OrderStatus) => order.activity.find((a) => a.toStatus === s)?.createdAt ?? null;
  const stepTimes = [
    order.createdAt,
    order.pickup?.completedAt ?? null,
    firstAt("PROCESSING"),
    firstAt("QC_PENDING"),
    order.readyAt,
    order.delivery?.startedAt ?? null,
    order.deliveredAt,
  ].map((d) => (d ? formatDateTime(d) : null));
  const stepIndex = customerStepIndex(status);
  const headline =
    status === "CANCELLED"
      ? "Cancelled"
      : status === "PICKUP_ASSIGNED"
      ? order.pickup?.scheduledAt
        ? `Pickup on ${formatDateTime(order.pickup.scheduledAt)}`
        : "Pickup scheduled"
      : CUSTOMER_STEPS[stepIndex];
  const upi =
    settings.upiId && balance > 0
      ? `upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.businessName)}&am=${(balance / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Order ${order.orderNumber}`)}`
      : null;
  const supportWa = settings.supportWhatsApp || settings.supportPhone;

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <AutoRefresh seconds={60} />
      <header className="bg-brand-800 px-4 pb-6 pt-5 text-white">
        <div className="mx-auto max-w-xl">
          <div className="text-sm font-semibold opacity-80">{settings.businessName}</div>
          <h1 className="mt-3 text-2xl font-bold">Hi {order.customer.name.split(" ")[0]},</h1>
          <p className="mt-1 text-lg">
            Your order is: <span className="font-bold">{headline}</span>
          </p>
          <p className="mt-1 text-sm opacity-80">
            Order {order.orderNumber} · placed {formatDate(order.createdAt)}
          </p>
        </div>
      </header>

      <nav className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto grid max-w-xl grid-cols-4 text-center text-sm font-semibold text-slate-600">
          {[
            ["#order", "Order"],
            ["#status", "Status"],
            ["#payment", "Payment"],
            ["#support", "Support"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="flex h-12 items-center justify-center hover:text-brand-700">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-xl space-y-4 px-4 pt-4">
        <div id="status" className="scroll-mt-16">
          <Card className="p-5">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Order progress</h2>
            <Progress status={status} vertical times={stepTimes} />
          </Card>
        </div>

        {status !== "CANCELLED" && (
        <Card className="p-5">
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Status</h2>
          <div className="divide-y divide-slate-100">
            <Row label="Pickup">{lines.pickup}</Row>
            <Row label="Processing">{lines.processing}</Row>
            <Row label="Quality check">{lines.qc}</Row>
            <Row label="Ready">{lines.ready}</Row>
            <Row label="Delivery">
              {status === "READY" && order.delivery?.scheduledAt ? `Planned ${formatDateTime(order.delivery.scheduledAt)}` : lines.delivery}
            </Row>
            <Row label="Payment">{order.total <= 0 ? "Will be confirmed after pickup" : balance <= 0 ? "Paid" : order.amountPaid > 0 ? "Partly paid" : "Pending"}</Row>
          </div>
        </Card>
        )}

        <div id="order" className="scroll-mt-16">
          <Card className="p-5">
            <h2 className="mb-2 text-lg font-semibold text-slate-900">Your items</h2>
            {order.items.length === 0 ? (
              <p className="text-slate-500">We will list your items after pickup.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {order.items.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900">{i.itemName}</div>
                      <div className="text-sm text-slate-500">
                        {i.serviceName} · {i.quantity} {UNIT_LABEL[i.unit]}
                      </div>
                    </div>
                    <div className="shrink-0 font-semibold text-slate-900">{money(i.lineTotal)}</div>
                  </li>
                ))}
              </ul>
            )}
            {order.specialInstructions && <p className="mt-2 text-sm text-slate-600">Your instructions: {order.specialInstructions}</p>}
          </Card>
        </div>

        <div id="payment" className="scroll-mt-16">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900">Payment</h2>
              {order.total > 0 && <Badge tone={balance <= 0 ? "success" : "warning"}>{balance <= 0 ? "Paid" : `${money(balance)} due`}</Badge>}
            </div>
            <div className="divide-y divide-slate-100">
              <Row label="Subtotal">{money(order.subtotal)}</Row>
              {order.discount > 0 && <Row label="Discount">− {money(order.discount)}</Row>}
              {order.tax > 0 && <Row label="Tax">{money(order.tax)}</Row>}
              <Row label="Total">{money(order.total)}</Row>
              <Row label="Paid">{money(order.amountPaid)}</Row>
              <Row label="Balance due">{money(balance)}</Row>
            </div>
            {order.payments.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
                {order.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span>
                      {PAYMENT_METHOD_LABEL[p.method]} · {formatDate(p.createdAt)}
                    </span>
                    <span className="font-medium text-slate-900">{money(p.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
            {upi && (
              <a href={upi} className="mt-4 flex h-14 items-center justify-center gap-2 rounded-xl bg-brand-700 text-base font-semibold text-white">
                <CreditCard className="h-5 w-5" /> Pay {money(balance)} with UPI
              </a>
            )}
            {balance > 0 && !upi && <p className="mt-3 text-sm text-slate-500">You can pay our delivery person by cash or UPI.</p>}
          </Card>
        </div>

        <div id="support" className="scroll-mt-16">
          <Card className="p-5">
            <h2 className="mb-1 text-lg font-semibold text-slate-900">Need help?</h2>
            <p className="mb-3 text-sm text-slate-500">Mention order {order.orderNumber}.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {supportWa && (
                <a
                  href={whatsappUrl(supportWa, `Hi, I have a question about order ${order.orderNumber}.`)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 font-semibold text-white"
                >
                  <MessageCircle className="h-5 w-5" /> WhatsApp us
                </a>
              )}
              {settings.supportPhone && (
                <a href={`tel:+${settings.supportPhone.replace(/\D/g, "")}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 font-semibold text-slate-800">
                  <Phone className="h-5 w-5" /> Call {displayPhone(settings.supportPhone.replace(/\D/g, "").length === 10 ? `91${settings.supportPhone.replace(/\D/g, "")}` : settings.supportPhone)}
                </a>
              )}
              {settings.supportEmail && (
                <a href={`mailto:${settings.supportEmail}?subject=${encodeURIComponent(`Order ${order.orderNumber}`)}`} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 font-semibold text-slate-800">
                  <Mail className="h-5 w-5" /> Email us
                </a>
              )}
              {!supportWa && !settings.supportPhone && !settings.supportEmail && <p className="text-sm text-slate-500">Reply to the WhatsApp message we sent you.</p>}
            </div>
            <p className="mt-4 text-xs text-slate-400">You will get WhatsApp updates when your order is picked up, ready and out for delivery.</p>
          </Card>
        </div>
      </main>
    </div>
  );
}
