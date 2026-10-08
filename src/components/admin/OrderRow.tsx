import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge, PaymentBadge } from "@/components/ui";
import { money, formatDateTime } from "@/lib/format";
import type { OrderListRow } from "@/lib/server/queries";

/** One order as a tappable row — stacks on phones, single line on desktop. */
export function OrderRow({ order, note }: { order: OrderListRow; note?: string }) {
  const fm = order.delivery?.assignedTo?.name ?? order.pickup?.assignedTo?.name;
  return (
    <Link href={`/admin/orders/${order.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 active:bg-slate-100">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900">{order.orderNumber}</span>
          <StatusBadge status={order.status} />
          {order.total > 0 && order.status !== "CANCELLED" && <PaymentBadge total={order.total} paid={order.amountPaid} />}
        </div>
        <div className="mt-1 truncate text-sm text-slate-700">{order.customer.name}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          {note ? <span className="font-semibold text-amber-700">{note}</span> : formatDateTime(order.createdAt)}
          {fm ? ` · ${fm}` : ""}
          {` · ${order._count.items} item line${order._count.items === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-semibold text-slate-900">{order.total > 0 ? money(order.total) : "—"}</div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
    </Link>
  );
}
