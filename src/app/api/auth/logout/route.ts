import { api } from "@/lib/server/http";
import { destroySession } from "@/lib/server/session";

export const POST = api(async () => {
  destroySession();
  return { signedOut: true };
});
