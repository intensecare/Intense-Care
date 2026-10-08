"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { Search, Plus, LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function Navbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { fontSize, setFontSize } = useApp();
  const { currentUser, logout, can, roleLabel } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/jobs?q=${encodeURIComponent(searchQuery.trim())}`);
  };

  return (
    <header className="h-14 border-b border-zinc-200 bg-white px-4 sm:px-6 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-3">
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-1.5 rounded text-zinc-600 hover:bg-zinc-100"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        {/* Global Quick Search */}
        <form onSubmit={handleSearch} className="relative w-48 sm:w-72">
          <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search jobs, customers, phone…"
            className="h-8 pl-9 text-xs bg-zinc-50 border-zinc-200 focus-visible:ring-1 focus-visible:ring-rose-500 focus-visible:border-rose-500 rounded text-zinc-900 placeholder:text-zinc-400"
          />
        </form>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Font Size Accessibility Controller (-A, A, +A) */}
        <div className="hidden sm:flex items-center bg-zinc-100 rounded border border-zinc-200 p-0.5 font-sans text-xs">
          <button
            onClick={() => setFontSize("sm")}
            title="Small Font Size (-A)"
            className={cn(
              "px-2 py-0.5 rounded text-[11px] font-semibold transition-all",
              fontSize === "sm" ? "bg-zinc-900 text-white shadow-xs" : "text-zinc-600 hover:text-black hover:bg-zinc-200"
            )}
          >
            -A
          </button>
          <button
            onClick={() => setFontSize("md")}
            title="Normal Font Size (A)"
            className={cn(
              "px-2 py-0.5 rounded text-[11px] font-semibold transition-all",
              fontSize === "md" ? "bg-zinc-900 text-white shadow-xs" : "text-zinc-600 hover:text-black hover:bg-zinc-200"
            )}
          >
            A
          </button>
          <button
            onClick={() => setFontSize("lg")}
            title="Large Font Size (+A)"
            className={cn(
              "px-2 py-0.5 rounded text-[11px] font-semibold transition-all",
              fontSize === "lg" ? "bg-zinc-900 text-white shadow-xs" : "text-zinc-600 hover:text-black hover:bg-zinc-200"
            )}
          >
            +A
          </button>
          <button
            onClick={() => setFontSize("xl")}
            title="Extra Large Font Size (++A)"
            className={cn(
              "px-2 py-0.5 rounded text-[11px] font-semibold transition-all",
              fontSize === "xl" ? "bg-zinc-900 text-white shadow-xs" : "text-zinc-600 hover:text-black hover:bg-zinc-200"
            )}
          >
            ++A
          </button>
        </div>

        {/* Quick New Job — anyone who may create jobs */}
        {can("jobs.create") && (
          <Link href="/jobs?create=true">
            <Button size="sm" className="h-8 text-xs bg-rose-500 hover:bg-rose-600 text-white font-medium rounded px-3 shadow-xs border border-zinc-800">
              <Plus className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">New Job</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        )}

        {/* User Chip & Logout */}
        {currentUser && (
          <div className="flex items-center gap-2 pl-2 border-l border-zinc-200">
            <div className="h-7 w-7 rounded bg-rose-500 text-white flex items-center justify-center text-xs font-semibold">
              {currentUser.name.charAt(0)}
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-medium text-zinc-900 leading-none">
                {currentUser.name}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                {roleLabel}
              </div>
            </div>

            <button
              onClick={logout}
              title="Sign Out"
              className="p-1 rounded text-zinc-400 hover:text-black hover:bg-zinc-100 transition-colors ml-1"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

