import { prisma } from "@/lib/server/prisma";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui";
import { ServiceFormButton } from "@/components/admin/forms";
import { money, UNIT_LABEL } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const services = await prisma.service.findMany({ orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { name: "asc" }] });
  return (
    <>
      <PageTitle title="Services & Pricing" subtitle="Price changes apply to new orders; existing orders keep their price." action={<ServiceFormButton />} />
      <Card>
        {services.length === 0 ? (
          <div className="p-4"><EmptyState title="No services yet" text="Add your first service, e.g. Wash & Fold per kg." /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-900">{s.name}</span>
                    {!s.active && <Badge>Hidden</Badge>}
                  </div>
                  <div className="text-sm text-slate-600">
                    {money(s.price)} per {UNIT_LABEL[s.unit]} · ready in {s.turnaroundHours} h
                  </div>
                  {s.description && <div className="text-sm text-slate-500">{s.description}</div>}
                </div>
                <ServiceFormButton service={s} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
