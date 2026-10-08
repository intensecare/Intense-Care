import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/session";
import { homeFor } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Sends each signed-in role to its one home. */
export default async function Root() {
  const user = await getSessionUser();
  redirect(user ? homeFor(user.role) : "/login");
}
