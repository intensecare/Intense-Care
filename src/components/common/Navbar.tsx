"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/app-context";
import { useAuth } from "@/lib/auth-context";
import { Search, Bell, Plus, LogOut, Menu, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";

export function Navbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { smsGatewayLogs, fetchSmsGatewayLog, fontSize, setFontSize } = useApp();
  const { currentUser, logout } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [showNotifications, setShowNotifications] = useState(false);
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/jobs?q=${encodeURIComponent(searchQuery.trim())}`);
  };

  const recentDispatches = smsGatewayLogs.slice(0, 5);

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
            placeholder="Search job ID, customer, phone..."
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

        {/* Quick New Job Button - Super Admin Only */}
        {currentUser?.role === "super_admin" && (
          <Link href="/jobs?create=true">
            <Button size="sm" className="h-8 text-xs bg-rose-500 hover:bg-rose-600 text-white font-medium rounded px-3 shadow-xs border border-zinc-800">
              <Plus className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">New Booking</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        )}

        {/* Gateway Activity Bell */}
        <div className="relative">
          <button
            onClick={() => {
              setShowNotifications(!showNotifications);
              void fetchSmsGatewayLog();
            }}
            className="p-1.5 rounded text-zinc-600 hover:text-black hover:bg-zinc-100 transition-colors relative"
            title="SMS Gateway Activity"
          >
            <Bell className="h-4 w-4" />
            {smsGatewayLogs.some((l) => l.status === "FAILED") && (
              <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-red-500" />
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 rounded border border-zinc-200 bg-white p-3 shadow-lg z-50 animate-in fade-in-0 zoom-in-95">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-zinc-100">
                <span className="text-xs font-semibold text-zinc-900">
                  SMS Gateway Activity
                </span>
                <Link
                  href="/notifications"
                  onClick={() => setShowNotifications(false)}
                  className="text-[11px] text-zinc-600 hover:text-black font-medium underline underline-offset-2"
                >
                  View all
                </Link>
              </div>

              <div className="space-y-2 max-h-72 overflow-y-auto">
                {recentDispatches.length === 0 ? (
                  <p className="text-[11px] text-zinc-400 text-center py-4">
                    No SMS dispatches recorded yet.
                  </p>
                ) : (
                  recentDispatches.map((n) => (
                    <div
                      key={n.id}
                      className="p-2 rounded bg-zinc-50 hover:bg-zinc-100 transition-colors text-xs border border-zinc-100"
                    >
                      <div className="flex items-center justify-between font-medium text-zinc-900">
                        <span className="truncate font-mono">{n.jobId || "—"}</span>
                        <span
                          className={`text-[10px] font-mono px-1 rounded ${
                            n.status === "SENT"
                              ? "bg-emerald-100 text-emerald-800"
                              : n.status === "FAILED"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {n.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                        Arrival OTP to {n.recipientMasked}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

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
                {currentUser.role.replace("_", " ")}
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

