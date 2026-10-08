import { Badge, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/workflow";
import type { qcHistory } from "@/lib/server/queries";

type Rows = Awaited<ReturnType<typeof qcHistory>>;

export function HistoryList({ rows, empty }: { rows: Rows; empty: string }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{r.order.orderNumber}</div>
              <div className="font-semibold text-slate-900">{r.order.customer.name}</div>
            </div>
            <Badge tone={r.result === "PASSED" ? "success" : "danger"}>{r.result === "PASSED" ? "Passed" : r.result === "FAILED" ? "Failed" : "Rework"}</Badge>
          </div>
          {r.reason && <p className="mt-2 text-sm text-slate-700">{r.reason}</p>}
          <p className="mt-2 text-xs text-slate-500">
            {r.inspector.name} · {formatDateTime(r.createdAt)} · now {STATUS_LABEL[r.order.status]}
          </p>
        </div>
      ))}
    </div>
  );
}
