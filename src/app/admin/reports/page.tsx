import Link from "next/link";
import { prisma } from "@/lib/server/prisma";
import { Card, CardHeader, EmptyState, PageTitle, Stat } from "@/components/ui";
import { dayRange } from "@/lib/server/time";
import { cn, money } from "@/lib/format";

export const dynamic = "force-dynamic";

const PERIODS = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

export default async function ReportsPage({ searchParams }: { searchParams: { days?: string } }) {
  const days = PERIODS.some((p) => String(p.days) === searchParams.days) ? Number(searchParams.days) : 30;
  const { start } = dayRange(new Date(), days - 1);
  const since = { gte: start };

  const [created, delivered, cancelled, collected, qc, items, fms, outstanding] = await Promise.all([
    prisma.order.count({ where: { createdAt: since } }),
    prisma.order.findMany({ where: { deliveredAt: since }, select: { createdAt: true, deliveredAt: true, total: true } }),
    prisma.order.count({ where: { cancelledAt: since } }),
    prisma.payment.aggregate({ where: { createdAt: since }, _sum: { amount: true }, _count: true }),
    prisma.qCRecord.groupBy({ by: ["result"], where: { createdAt: since }, _count: { _all: true } }),
    prisma.orderItem.groupBy({
      by: ["serviceName"],
      where: { order: { createdAt: since, status: { not: "CANCELLED" } } },
      _sum: { lineTotal: true, quantity: true },
      orderBy: { _sum: { lineTotal: "desc" } },
      take: 10,
    }),
    prisma.user.findMany({
      where: { role: "FIELD_MANAGER" },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            pickups: { where: { status: "COMPLETED", completedAt: since } },
            deliveries: { where: { status: "COMPLETED", completedAt: since } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.order.findMany({ where: { status: { not: "CANCELLED" }, paymentStatus: { not: "PAID" }, total: { gt: 0 } }, select: { total: true, amountPaid: true } }),
  ]);

  const qcCount = (r: string) => qc.find((x) => x.result === r)?._count._all ?? 0;
  const qcTotal = qcCount("PASSED") + qcCount("FAILED") + qcCount("REWORK");
  const passRate = qcTotal ? Math.round((qcCount("PASSED") / qcTotal) * 100) : null;
  const turnaround = delivered.length
    ? Math.round(delivered.reduce((a, o) => a + ((o.deliveredAt?.getTime() ?? 0) - o.createdAt.getTime()), 0) / delivered.length / 3600000)
    : null;
  const due = outstanding.reduce((a, o) => a + o.total - o.amountPaid, 0);

  return (
    <>
      <PageTitle title="Reports" subtitle="How the business is doing." />
      <div className="mb-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.days}
            href={`/admin/reports?days=${p.days}`}
            className={cn("flex h-10 items-center rounded-full border px-4 text-sm font-medium", p.days === days ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 text-slate-700")}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Orders created" value={created} />
        <Stat label="Orders delivered" value={delivered.length} tone="success" />
        <Stat label="Collected" value={money(collected._sum.amount ?? 0)} tone="success" />
        <Stat label="Outstanding (all time)" value={money(due)} tone={due ? "warning" : "neutral"} />
        <Stat label="QC pass rate" value={passRate === null ? "—" : `${passRate}%`} tone={passRate !== null && passRate < 90 ? "warning" : "neutral"} />
        <Stat label="Avg. order → delivery" value={turnaround === null ? "—" : `${turnaround} h`} />
        <Stat label="QC failed / rework" value={qcCount("FAILED") + qcCount("REWORK")} tone={qcCount("FAILED") + qcCount("REWORK") ? "danger" : "neutral"} />
        <Stat label="Cancelled" value={cancelled} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by service" />
          {items.length === 0 ? (
            <div className="p-4"><EmptyState title="No orders in this period" /></div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((i) => (
                <li key={i.serviceName} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-slate-800">{i.serviceName}</span>
                  <span className="font-semibold text-slate-900">{money(i._sum.lineTotal ?? 0)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Field managers" />
          {fms.length === 0 ? (
            <div className="p-4"><EmptyState title="No field managers yet" /></div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {fms.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-slate-800">{f.name}</span>
                  <span className="text-sm text-slate-600">
                    {f._count.pickups} pickups · {f._count.deliveries} deliveries
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
