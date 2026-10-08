import { requirePageUser } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { AdminShell } from "@/components/shells";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser(["ADMIN"]);
  const settings = await getSettings();
  return (
    <AdminShell businessName={settings.businessName} userName={user.name}>
      {children}
    </AdminShell>
  );
}
