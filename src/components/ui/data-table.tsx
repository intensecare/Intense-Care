"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Where the column goes on the phone card. Default: a labelled row. */
  mobile?: "title" | "subtitle" | "badge" | "row" | "hide";
  className?: string;
  align?: "left" | "right";
}

/**
 * The one list component: a clean table on desktop (xl+), one card per row
 * on phones and tablets — never a squeezed table. Priority info comes first
 * on the card (title, subtitle, badge), the rest as labelled rows.
 */
export function DataTable<T>({
  rows: allRows,
  columns,
  rowKey,
  href,
  actions,
  caption,
  pageSize = 25,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  href?: (row: T) => string;
  actions?: (row: T) => React.ReactNode;
  caption?: string;
  /** Rows per page (default 25). Pass 0 when the list is already paged by the server. */
  pageSize?: number;
}) {
  const [page, setPage] = React.useState(1);
  const pages = pageSize > 0 ? Math.max(1, Math.ceil(allRows.length / pageSize)) : 1;
  const current = Math.min(page, pages);
  const rows = pageSize > 0 ? allRows.slice((current - 1) * pageSize, current * pageSize) : allRows;
  const title = columns.find((c) => c.mobile === "title") ?? columns[0];
  const subtitle = columns.find((c) => c.mobile === "subtitle");
  const badge = columns.find((c) => c.mobile === "badge");
  const rest = columns.filter((c) => c !== title && c !== subtitle && c !== badge && c.mobile !== "hide");

  return (
    <>
      <div className="hidden xl:block rounded-2xl border border-zinc-200 bg-white overflow-hidden">
        <table className="w-full text-left text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-500">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("py-3 px-4 first:pl-5 font-semibold whitespace-nowrap", c.align === "right" && "text-right")}>
                  {c.header}
                </th>
              ))}
              {(href || actions) && <th scope="col" className="py-3 px-5"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-zinc-50 transition-colors">
                {columns.map((c) => (
                  <td key={c.key} className={cn("py-3.5 px-4 first:pl-5 align-middle text-zinc-800", c.align === "right" && "text-right", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
                {(href || actions) && (
                  <td className="py-3.5 px-5 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      {actions?.(row)}
                      {href && (
                        <Link href={href(row)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-300 px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50">
                          Open <ChevronRight className="h-4 w-4" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="xl:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((row) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-zinc-950 break-words">{title.cell(row)}</div>
                  {subtitle && <div className="text-sm text-zinc-500 break-words">{subtitle.cell(row)}</div>}
                </div>
                {badge && <div className="shrink-0">{badge.cell(row)}</div>}
              </div>
              {rest.length > 0 && (
                <dl className="mt-3 space-y-1.5 text-sm">
                  {rest.map((c) => (
                    <div key={c.key} className="flex items-start justify-between gap-3">
                      <dt className="text-zinc-500 shrink-0">{c.header}</dt>
                      <dd className="text-zinc-900 text-right min-w-0 break-words">{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          );
          return (
            <li key={rowKey(row)} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
              {href ? (
                <Link href={href(row)} className="block p-4 active:bg-zinc-50">
                  {body}
                  <div className="mt-3 pt-3 border-t border-zinc-100 text-sm font-semibold text-rose-600 inline-flex items-center gap-0.5 w-full justify-end">
                    Open <ChevronRight className="h-4 w-4" aria-hidden />
                  </div>
                </Link>
              ) : (
                <div className="p-4">{body}</div>
              )}
              {actions && <div className="px-4 pb-4 -mt-1 flex flex-wrap gap-2">{actions(row)}</div>}
            </li>
          );
        })}
      </ul>
      {pageSize > 0 && pages > 1 && <Pager page={current} pages={pages} total={allRows.length} pageSize={pageSize} onPage={setPage} />}
    </>
  );
}

/** Previous / Next with a "26–50 of 120" count — for client-paged and server-paged lists. */
export function Pager({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
      <span className="text-sm text-zinc-500">{from}–{to} of {total}</span>
      <div className="flex gap-2">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className="min-h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 disabled:opacity-40">Previous</button>
        <span className="self-center text-sm text-zinc-600 tabular-nums">Page {page} of {pages}</span>
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pages} className="min-h-11 px-4 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800 disabled:opacity-40">Next</button>
      </div>
    </nav>
  );
}
