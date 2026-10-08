import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/session";
import { homeFor } from "@/lib/server/auth";
import { getSettings } from "@/lib/server/settings";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  const settings = await getSettings();
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-brand-700" />
          <h1 className="text-2xl font-bold text-slate-900">{settings.businessName}</h1>
          <p className="mt-1 text-sm text-slate-500">Staff sign in</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-slate-400">Customers: open the order link we sent you on WhatsApp.</p>
      </div>
    </div>
  );
}
