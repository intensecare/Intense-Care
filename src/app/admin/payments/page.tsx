import Link from "next/link";
import { prisma } from "@/lib/server/prisma";
import { Card, CardHeader, EmptyState, PageTitle, Stat, StatusBadge } from "@/components/ui";
import { RecordPaymentButton } from "@/components/admin/OrderControls";
import { formatDateTime, money, PAYMENT_METHOD_LABEL } from "@/lib/format";
import { dayRange } from "@/lib/server/time";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const today = dayRange();
  const [due, recent, todaySum] = await Promise.all([
    prisma.order.findMany({
      where: { status: { not: "CANCELLED" }, paymentStatus: { not: "PAID" }, total: { gt: 0 } },
      include: { customer: { select: { name: true } } },
      orderBy: [{ deliveredAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      take: 100,
    }),
    prisma.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { order: { select: { id: true, orderNumber: true, customer: { select: { name: true } } } }, receivedBy: { select: { name: true } } },
    }),
    prisma.payment.aggregate({ where: { createdAt: { gte: today.start, lt: today.end } }, _sum: { amount: true } }),
  ]);
  const outstanding = due.reduce((a, o) => a + (o.total - o.amountPaid), 0);

  return (
    <>
      <PageTitle title="Payments" subtitle="Who still owes money, and what came in." />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Outstanding" value={money(outstanding)} tone={outstanding ? "warning" : "neutral"} />
        <Stat label="Unpaid orders" value={due.length} />
        <Stat label="Collected today" value={money(todaySum._sum.amount ?? 0)} tone="success" />
      </div>

      <Card className="mb-4">
        <CardHeader title="Pending payments" />
        {due.length === 0 ? (
          <div className="p-4"><EmptyState title="Nothing outstanding" /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {due.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <Link href={`/admin/orders/${o.id}`} className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{o.orderNumber}</span>
                    <StatusBadge status={o.status} />
                  </div>
                  <div className="text-sm text-slate-600">{o.customer.name}</div>
                  <div className="text-sm text-slate-500">
                    {money(o.total - o.amountPaid)} due of {money(o.total)}
                  </div>
                </Link>
                <RecordPaymentButton orderId={o.id} balance={o.total - o.amountPaid} label="Record" />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent payments" />
        {recent.length === 0 ? (
          <div className="p-4"><EmptyState title="No payments yet" /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link href={`/admin/orders/${p.order.id}`} className="min-w-0">
                  <div className="font-medium text-slate-900">
                    {p.order.orderNumber} · {p.order.customer.name}
                  </div>
                  <div className="text-sm text-slate-500">
                    {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference ? ` · ${p.reference}` : ""} · {formatDateTime(p.createdAt)}
                    {p.receivedBy ? ` · ${p.receivedBy.name}` : ""}
                  </div>
                </Link>
                <span className="shrink-0 font-semibold text-slate-900">{money(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
