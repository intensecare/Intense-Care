import { qcOrders } from "@/lib/server/queries";
import { EmptyState } from "@/components/ui";
import { QcCard } from "@/components/qc/QcCard";
import { toQcCard } from "@/components/qc/to-card";
import { AutoRefresh } from "@/components/AutoRefresh";

export const dynamic = "force-dynamic";

/** QC home — "What do I need to inspect?" */
export default async function QcQueue() {
  const [pending, rework] = await Promise.all([qcOrders(["QC_PENDING"]), qcOrders(["QC_FAILED", "REWORK"])]);
  return (
    <>
      <AutoRefresh seconds={20} />
      <h1 className="mb-1 text-2xl font-bold text-slate-900">QC Queue</h1>
      <p className="mb-4 text-sm text-slate-500">
        {pending.length} pending · {rework.length} in rework
      </p>
      {pending.length === 0 ? (
        <EmptyState title="Nothing to inspect" text="Orders appear here as soon as processing is done." />
      ) : (
        <div className="space-y-3">
          {pending.map((o) => (
            <QcCard key={o.id} order={toQcCard(o)} canAct />
          ))}
        </div>
      )}
      {rework.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Rework — comes back here after fixing</h2>
          <div className="space-y-3">
            {rework.map((o) => (
              <QcCard key={o.id} order={toQcCard(o)} canAct={false} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
