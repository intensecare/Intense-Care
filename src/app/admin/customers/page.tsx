import Link from "next/link";
import { Search } from "lucide-react";
import { prisma } from "@/lib/server/prisma";
import { Card, EmptyState, PageTitle, buttonClass } from "@/components/ui";
import { CustomerFormButton } from "@/components/admin/forms";
import { displayPhone, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const customers = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : [])] } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { _count: { select: { orders: true } }, orders: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
  });

  return (
    <>
      <PageTitle title="Customers" subtitle="Every customer and their orders." action={<CustomerFormButton />} />
      <form action="/admin/customers" className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input name="q" defaultValue={q} placeholder="Name or phone" className="h-11 w-full rounded-xl border border-slate-300 pl-11 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100" />
        </div>
        <button className={buttonClass("secondary")}>Search</button>
      </form>
      <Card>
        {customers.length === 0 ? (
          <div className="p-4"><EmptyState title="No customers yet" text="Customers are added automatically when you create an order." /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {customers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{c.name}</div>
                  <div className="text-sm text-slate-600">{displayPhone(c.phone)}</div>
                  <div className="truncate text-sm text-slate-500">{c.address}</div>
                  <div className="text-xs text-slate-400">
                    {c._count.orders} order{c._count.orders === 1 ? "" : "s"}
                    {c.orders[0] ? ` · last ${formatDate(c.orders[0].createdAt)}` : ""}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/orders?customer=${c.id}`} className={buttonClass("secondary")}>Orders</Link>
                  <Link href={`/admin/orders/new?customer=${c.id}`} className={buttonClass("secondary")}>New order</Link>
                  <CustomerFormButton customer={{ id: c.id, name: c.name, phone: c.phone, address: c.address, email: c.email ?? "", notes: c.notes ?? "" }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
