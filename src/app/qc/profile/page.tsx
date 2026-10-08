import { requirePageUser } from "@/lib/server/auth";
import { ProfileView } from "@/components/staff/ProfileView";
import { displayPhone } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function QcProfile() {
  const u = await requirePageUser(["QC"]);
  return <ProfileView name={u.name} email={u.email} phone={displayPhone(u.phone)} roleLabel="Quality Control" />;
}
