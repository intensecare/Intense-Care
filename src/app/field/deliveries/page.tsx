import { requirePageUser } from "@/lib/server/auth";
import { fieldTasks } from "@/lib/server/queries";
import { EmptyState } from "@/components/ui";
import { DeliveryCard } from "@/components/field/TaskCards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { deliveryProps } from "@/components/field/serialize";

export const dynamic = "force-dynamic";

export default async function FieldDeliveries() {
  const user = await requirePageUser(["FIELD_MANAGER"]);
  const { deliveries } = await fieldTasks(user.id);
  const open = deliveries.filter((d) => d.status !== "COMPLETED");
  open.sort((a, b) => Number(b.order.status === "OUT_FOR_DELIVERY") - Number(a.order.status === "OUT_FOR_DELIVERY"));
  const done = deliveries.filter((d) => d.status === "COMPLETED");
  return (
    <>
      <AutoRefresh seconds={30} />
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Deliveries</h1>
      {open.length === 0 ? <EmptyState title="No deliveries waiting" /> : <div className="space-y-3">{open.map((d) => <DeliveryCard key={d.id} {...deliveryProps(d)} />)}</div>}
      {done.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Delivered today</h2>
          <div className="space-y-3">{done.map((d) => <DeliveryCard key={d.id} {...deliveryProps(d)} />)}</div>
        </>
      )}
    </>
  );
}
