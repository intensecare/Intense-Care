import { prisma } from "@/lib/server/prisma";
import { getSettings } from "@/lib/server/settings";
import { activeFieldManagers } from "@/lib/server/queries";
import { PageTitle } from "@/components/ui";
import { OrderForm } from "@/components/admin/OrderForm";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({ searchParams }: { searchParams: { customer?: string } }) {
  const [services, fieldManagers, settings, customer] = await Promise.all([
    prisma.service.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, unit: true, price: true } }),
    activeFieldManagers(),
    getSettings(),
    searchParams.customer
      ? prisma.customer.findUnique({ where: { id: searchParams.customer }, select: { id: true, name: true, phone: true, address: true } })
      : Promise.resolve(null),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle title="New Order" subtitle="The pickup is assigned automatically and the customer gets their tracking link on WhatsApp." />
      <OrderForm services={services} fieldManagers={fieldManagers} taxPercent={settings.taxPercent} initialCustomer={customer} />
    </div>
  );
}
