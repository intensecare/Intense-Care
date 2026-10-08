import { qcHistory } from "@/lib/server/queries";
import { HistoryList } from "@/components/qc/HistoryList";

export const dynamic = "force-dynamic";

export default async function QcPassed() {
  const rows = await qcHistory("PASSED");
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold text-slate-900">Passed</h1>
      <HistoryList rows={rows} empty="No passed inspections yet" />
    </>
  );
}
