import { requirePageUser } from "@/lib/server/auth";
import { fieldTasks } from "@/lib/server/queries";
import { isCloudinaryConfigured } from "@/lib/server/cloudinary";
import { EmptyState, Stat } from "@/components/ui";
import { PickupCard, DeliveryCard } from "@/components/field/TaskCards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { pickupProps, deliveryProps } from "@/components/field/serialize";

export const dynamic = "force-dynamic";

/** FIELD MANAGER home — "What do I need to pick up or deliver today?" */
export default async function FieldToday() {
  const user = await requirePageUser(["FIELD_MANAGER"]);
  const { pickups, deliveries, today } = await fieldTasks(user.id);
  const isDueToday = (d: Date | null) => !d || d < today.end;
  const pendingPickups = pickups.filter((p) => p.status !== "COMPLETED" && isDueToday(p.scheduledAt));
  const pendingDeliveries = deliveries.filter((d) => d.status !== "COMPLETED" && isDueToday(d.scheduledAt));
  const completed = pickups.filter((p) => p.status === "COMPLETED").length + deliveries.filter((d) => d.status === "COMPLETED").length;
  const later = pickups.filter((p) => p.status !== "COMPLETED").length - pendingPickups.length + deliveries.filter((d) => d.status !== "COMPLETED").length - pendingDeliveries.length;
  const photos = isCloudinaryConfigured();

  return (
    <>
      <AutoRefresh seconds={30} />
      <h1 className="mb-1 text-2xl font-bold text-slate-900">Today</h1>
      <p className="mb-4 text-sm text-slate-500">Hi {user.name.split(" ")[0]} — here is your day.</p>
      <div className="mb-5 grid grid-cols-2 gap-3">
        <Stat label="Pickups" value={pendingPickups.length} href="/field/pickups" tone={pendingPickups.length ? "warning" : "neutral"} />
        <Stat label="Deliveries" value={pendingDeliveries.length} href="/field/deliveries" tone={pendingDeliveries.length ? "warning" : "neutral"} />
        <Stat label="Pending" value={pendingPickups.length + pendingDeliveries.length} />
        <Stat label="Completed" value={completed} tone="success" />
      </div>

      {pendingPickups.length + pendingDeliveries.length === 0 ? (
        <EmptyState title="You're all done for today" text={later > 0 ? `${later} job${later === 1 ? "" : "s"} scheduled for later.` : "New jobs appear here as soon as they are assigned to you."} />
      ) : (
        <div className="space-y-3">
          {pendingDeliveries.filter((d) => d.order.status === "OUT_FOR_DELIVERY").map((d) => <DeliveryCard key={d.id} {...deliveryProps(d)} />)}
          {pendingPickups.map((p) => <PickupCard key={p.id} {...pickupProps(p)} photosEnabled={photos} />)}
          {pendingDeliveries.filter((d) => d.order.status !== "OUT_FOR_DELIVERY").map((d) => <DeliveryCard key={d.id} {...deliveryProps(d)} />)}
        </div>
      )}
    </>
  );
}
