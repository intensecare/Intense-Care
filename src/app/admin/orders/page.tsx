import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { listOrders } from "@/lib/server/queries";
import { prisma } from "@/lib/server/prisma";
import { Card, EmptyState, LinkButton, PageTitle, buttonClass } from "@/components/ui";
import { OrderRow } from "@/components/admin/OrderRow";
import { STATUS_GROUP_LABEL, type StatusGroup } from "@/lib/workflow";
import { cn } from "@/lib/format";

export const dynamic = "force-dynamic";

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  ...(Object.keys(STATUS_GROUP_LABEL) as StatusGroup[]).map((k) => ({ key: k, label: STATUS_GROUP_LABEL[k] })),
  { key: "unpaid", label: "Unpaid" },
];

export default async function OrdersPage({ searchParams }: { searchParams: { group?: string; q?: string; customer?: string; page?: string } }) {
  const { rows, total, page, pages } = await listOrders({
    group: searchParams.group,
    q: searchParams.q,
    customerId: searchParams.customer,
    page: Number(searchParams.page) || 1,
  });
  const customer = searchParams.customer ? await prisma.customer.findUnique({ where: { id: searchParams.customer }, select: { name: true } }) : null;

  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { group: searchParams.group, q: searchParams.q, customer: searchParams.customer, ...patch };
    Object.entries(merged).forEach(([k, v]) => v && p.set(k, v));
    const s = p.toString();
    return `/admin/orders${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageTitle
        title="Orders"
        subtitle={customer ? `Orders for ${customer.name}` : `${total} order${total === 1 ? "" : "s"}`}
        action={
          <LinkButton href={customer ? `/admin/orders/new?customer=${searchParams.customer}` : "/admin/orders/new"}>
            <Plus className="h-5 w-5" /> New Order
          </LinkButton>
        }
      />

      <form action="/admin/orders" className="mb-3 flex gap-2">
        {searchParams.group && <input type="hidden" name="group" value={searchParams.group} />}
        {searchParams.customer && <input type="hidden" name="customer" value={searchParams.customer} />}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={searchParams.q}
            placeholder="Order ID, customer name or phone"
            className="h-11 w-full rounded-xl border border-slate-300 pl-11 pr-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />
        </div>
        <button className={buttonClass("secondary")}>Search</button>
      </form>

      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {FILTERS.map((f) => (
          <Link
            key={f.key || "all"}
            href={href({ group: f.key || undefined, page: undefined })}
            className={cn(
              "flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-medium",
              (searchParams.group ?? "") === f.key ? "border-brand-700 bg-brand-700 text-white" : "border-slate-300 bg-white text-slate-700"
            )}
          >
            {f.label}
          </Link>
        ))}
        {customer && (
          <Link href="/admin/orders" className="flex h-10 shrink-0 items-center rounded-full border border-slate-300 px-4 text-sm text-slate-600">
            Clear customer ✕
          </Link>
        )}
      </div>

      <Card>
        {rows.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No orders found" text="Try another filter or create a new order." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((o) => (
              <OrderRow key={o.id} order={o} />
            ))}
          </div>
        )}
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          {page > 1 ? <LinkButton variant="secondary" href={href({ page: String(page - 1) })}>Previous</LinkButton> : <span />}
          <span className="text-sm text-slate-500">
            Page {page} of {pages}
          </span>
          {page < pages ? <LinkButton variant="secondary" href={href({ page: String(page + 1) })}>Next</LinkButton> : <span />}
        </div>
      )}
    </>
  );
}
