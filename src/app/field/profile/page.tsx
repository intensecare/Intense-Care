import { requirePageUser } from "@/lib/server/auth";
import { ProfileView } from "@/components/staff/ProfileView";
import { displayPhone } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FieldProfile() {
  const u = await requirePageUser(["FIELD_MANAGER"]);
  return <ProfileView name={u.name} email={u.email} phone={displayPhone(u.phone)} roleLabel="Field Manager" />;
}
