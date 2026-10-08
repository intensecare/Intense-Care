import { prisma } from "@/lib/server/prisma";
import { Badge, Card, PageTitle } from "@/components/ui";
import { UserFormButton } from "@/components/admin/forms";
import { displayPhone } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { ADMIN: "Admin", FIELD_MANAGER: "Field Manager", QC: "QC" } as const;

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { role: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          pickups: { where: { status: "ASSIGNED" } },
          deliveries: { where: { status: { in: ["ASSIGNED", "IN_PROGRESS"] } } },
        },
      },
    },
  });
  return (
    <>
      <PageTitle title="Users" subtitle="Admins, field managers and QC staff. Customers never need an account." action={<UserFormButton />} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{u.name}</span>
                  <Badge tone={u.role === "ADMIN" ? "neutral" : u.role === "QC" ? "warning" : "info"}>{ROLE_LABEL[u.role]}</Badge>
                  {!u.active && <Badge tone="danger">Disabled</Badge>}
                </div>
                <div className="text-sm text-slate-500 break-all">
                  {u.email}
                  {u.phone ? ` · ${displayPhone(u.phone)}` : ""}
                </div>
                {u.role === "FIELD_MANAGER" && (
                  <div className="text-xs text-slate-400">
                    {u._count.pickups} open pickup{u._count.pickups === 1 ? "" : "s"} · {u._count.deliveries} open deliver{u._count.deliveries === 1 ? "y" : "ies"}
                  </div>
                )}
              </div>
              <UserFormButton user={{ id: u.id, name: u.name, phone: u.phone, role: u.role, active: u.active }} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
