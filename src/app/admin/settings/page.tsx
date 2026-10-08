import { prisma } from "@/lib/server/prisma";
import { getSettings } from "@/lib/server/settings";
import { whatsappConfigured } from "@/lib/server/notify";
import { Badge, Card, CardHeader, EmptyState, PageTitle } from "@/components/ui";
import { SettingsForm, PasswordForm } from "@/components/admin/forms";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, notifications] = await Promise.all([
    getSettings(),
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 40, include: { order: { select: { orderNumber: true } } } }),
  ]);
  const wa = whatsappConfigured();
  return (
    <>
      <PageTitle title="Settings" />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Business" />
          <SettingsForm initial={settings} />
        </Card>

        <Card>
          <CardHeader title="Notifications" action={<Badge tone={wa ? "success" : "warning"}>{wa ? "WhatsApp connected" : "WhatsApp not configured"}</Badge>} />
          <div className="p-4">
            {!wa && (
              <p className="mb-3 text-sm text-slate-600">
                Set <code className="rounded bg-slate-100 px-1">WHATSAPP_ACCESS_TOKEN</code> and <code className="rounded bg-slate-100 px-1">WHATSAPP_PHONE_NUMBER_ID</code> on the server to send messages automatically. Until then every message is logged below and you can share links from the order screen.
              </p>
            )}
            {notifications.length === 0 ? (
              <EmptyState title="No messages yet" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <li key={n.id} className="py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">
                        {n.order?.orderNumber ?? "—"} · {n.event.replace(/_/g, " ").toLowerCase()}
                      </span>
                      <Badge tone={n.status === "SENT" ? "success" : n.status === "FAILED" ? "danger" : "neutral"}>{n.status.toLowerCase()}</Badge>
                    </div>
                    <div className="text-sm text-slate-500 break-words">{n.message}</div>
                    <div className="text-xs text-slate-400">
                      {formatDateTime(n.createdAt)}
                      {n.error ? ` · ${n.error}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="My password" />
          <div className="max-w-md p-4">
            <PasswordForm />
          </div>
        </Card>
      </div>
    </>
  );
}
