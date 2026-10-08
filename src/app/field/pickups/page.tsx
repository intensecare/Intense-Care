import { requirePageUser } from "@/lib/server/auth";
import { fieldTasks } from "@/lib/server/queries";
import { isCloudinaryConfigured } from "@/lib/server/cloudinary";
import { EmptyState } from "@/components/ui";
import { PickupCard } from "@/components/field/TaskCards";
import { AutoRefresh } from "@/components/AutoRefresh";
import { pickupProps } from "@/components/field/serialize";

export const dynamic = "force-dynamic";

export default async function FieldPickups() {
  const user = await requirePageUser(["FIELD_MANAGER"]);
  const { pickups } = await fieldTasks(user.id);
  const open = pickups.filter((p) => p.status !== "COMPLETED");
  const done = pickups.filter((p) => p.status === "COMPLETED");
  const photos = isCloudinaryConfigured();
  return (
    <>
      <AutoRefresh seconds={30} />
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Pickups</h1>
      {open.length === 0 ? <EmptyState title="No pickups waiting" /> : <div className="space-y-3">{open.map((p) => <PickupCard key={p.id} {...pickupProps(p)} photosEnabled={photos} />)}</div>}
      {done.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Done today</h2>
          <div className="space-y-3">{done.map((p) => <PickupCard key={p.id} {...pickupProps(p)} photosEnabled={false} />)}</div>
        </>
      )}
    </>
  );
}
