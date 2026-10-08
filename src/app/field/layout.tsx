import { requirePageUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { MobileShell } from "@/components/shells";

export const dynamic = "force-dynamic";

/** Field manager app — mobile first, no admin modules. */
export default async function FieldLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser(["FIELD_MANAGER"]);
  const settings = await getSettings();
  return (
    <MobileShell app="field" title={settings.businessName}>
      {children}
    </MobileShell>
  );
}
