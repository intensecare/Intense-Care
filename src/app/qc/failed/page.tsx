import { qcHistory } from "@/lib/server/queries";
import { HistoryList } from "@/components/qc/HistoryList";

export const dynamic = "force-dynamic";

export default async function QcFailed() {
  const rows = await qcHistory("FAILED");
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Failed & Rework</h1>
      <HistoryList rows={rows} empty="No failed inspections" />
    </>
  );
}
