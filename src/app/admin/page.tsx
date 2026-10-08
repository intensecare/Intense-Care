import { Plus } from "lucide-react";
import { adminDashboard, attentionOrders } from "@/lib/server/queries";
import { Card, CardHeader, EmptyState, LinkButton, PageTitle, Stat } from "@/components/ui";
import { OrderRow } from "@/components/admin/OrderRow";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

/** ADMIN home — "What needs my attention?" */
export default async function AdminDashboard() {
  const [d, attention] = await Promise.all([adminDashboard(), attentionOrders()]);
  return (
    <>
      <PageTitle
        title="Dashboard"
        subtitle="Everything that needs your attention today."
        action={
          <LinkButton href="/admin/orders/new">
            <Plus className="h-5 w-5" /> New Order
          </LinkButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Today's Orders" value={d.todayOrders} href="/admin/orders" />
        <Stat label="Pending Pickups" value={d.pendingPickups} href="/admin/orders?group=pickup" tone={d.pendingPickups ? "warning" : "neutral"} />
        <Stat label="Processing" value={d.processing} href="/admin/orders?group=processing" />
        <Stat label="QC Pending" value={d.qcPending} href="/admin/orders?group=qc" tone={d.qcPending ? "warning" : "neutral"} />
        <Stat label="QC Failed" value={d.qcFailed} href="/admin/orders?group=qcFailed" tone={d.qcFailed ? "danger" : "neutral"} />
        <Stat label="Ready" value={d.ready} href="/admin/orders?group=ready" tone={d.ready ? "success" : "neutral"} />
        <Stat label="Out for Delivery" value={d.outForDelivery} href="/admin/orders?group=delivery" />
        <Stat label="Delivered Today" value={d.deliveredToday} href="/admin/orders?group=delivered" tone="success" />
        <Stat label="Pending Payments" value={d.pendingPayments} href="/admin/payments" tone={d.pendingPayments ? "warning" : "neutral"} />
        <Stat label="Amount Due" value={money(d.pendingAmount)} href="/admin/payments" tone={d.pendingAmount ? "warning" : "neutral"} />
      </div>

      <Card className="mt-6">
        <CardHeader title={`Needs attention (${attention.length})`} />
        {attention.length === 0 ? (
          <div className="p-4">
            <EmptyState title="All clear" text="No order is waiting on you right now." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {attention.map(({ order, reason }) => (
              <OrderRow key={`${order.id}-${reason}`} order={order} note={reason} />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
