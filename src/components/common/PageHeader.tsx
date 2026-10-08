import React from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
}

/** Page title + one line of context + the page's main action(s). */
export function PageHeader({ title, description, badge, actions, breadcrumbs, className }: PageHeaderProps) {
  const back = breadcrumbs?.filter((b) => b.href).slice(-1)[0];
  return (
    <div className={cn("mb-6 sm:mb-8", className)}>
      {back && (
        <Link href={back.href!} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 mb-2 -ml-1">
          <ChevronLeft className="h-4 w-4" aria-hidden /> {back.label}
        </Link>
      )}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-950">{title}</h1>
            {badge}
          </div>
          {description && <p className="text-sm text-zinc-500 mt-1.5 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}
