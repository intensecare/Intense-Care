import { requirePageUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { MobileShell } from "@/components/shells";

export const dynamic = "force-dynamic";

/** QC app — the queue and nothing else. */
export default async function QcLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser(["QC"]);
  const settings = await getSettings();
  return (
    <MobileShell app="qc" title={`${settings.businessName} · QC`}>
      {children}
    </MobileShell>
  );
}
