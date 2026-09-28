"use client";

import React, { useState } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import {
  Building2,
  MapPin,
  Plus,
  Search,
  KeyRound,
  Car,
  Clock,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function PropertiesPage() {
  const { properties, customers, createProperty } = useApp();

  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Form State
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [title, setTitle] = useState("");
  const [propertyType, setPropertyType] = useState<any>("apartment");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("Bengaluru");
  const [bedrooms, setBedrooms] = useState(3);
  const [sqFt, setSqFt] = useState(1800);
  const [accessNotes, setAccessNotes] = useState("");
  const [parking, setParking] = useState("");
  const [recurring, setRecurring] = useState(false);

  const filteredProperties = properties.filter(
    (p) =>
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.city.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !address) return;

    const result = await createProperty({
      customerId,
      title,
      propertyType,
      address,
      city,
      bedrooms,
      carpetAreaSqFt: sqFt,
      accessNotes,
      parkingInstructions: parking,
      recurringService: recurring,
    });
    if (!result.success) return;

    setIsCreateOpen(false);
    setTitle("");
    setAddress("");
    setAccessNotes("");
    setParking("");
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Managed Properties Directory"
        description="Comprehensive facility register: villas, apartments, duplexes, and commercial spaces with gate security access instructions, GPS telemetry, and recurring schedules."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Properties" },
        ]}
        actions={
          <Button
            onClick={() => setIsCreateOpen(true)}
            size="sm"
            className="h-9 gap-1.5 bg-slate-900 text-white font-medium"
          >
            <Plus className="h-4 w-4" />
            Register Property
          </Button>
        }
      />

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 mb-5 shadow-xs">
        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by property title, address, or locality..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 bg-slate-50 border-slate-200"
          />
        </div>
      </div>

      {filteredProperties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={properties.length === 0 ? "No properties registered yet" : "No properties match your search"}
          description={
            properties.length === 0
              ? "Register residences, villas, apartments, or commercial facilities to store gate access codes, GPS telemetry, and parking notes for field workers."
              : "Try refining your search keywords or register a new property."
          }
          actionLabel="Register Property"
          onAction={() => setIsCreateOpen(true)}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProperties.map((p) => {
            const owner = customers.find((c) => c.id === p.customerId);

            return (
              <div
                key={p.id}
                className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{p.title}</span>
                    <span className="capitalize px-2 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700">
                      {p.propertyType}
                    </span>
                  </div>
                  {p.recurringService && (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Recurring Clean: {p.recurringFrequency || "Monthly"}
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-rose-500 shrink-0 mt-0.5" />
                    <span>{p.address} ({p.city})</span>
                  </div>

                  <div className="text-[11px] text-slate-400">
                    Owner / Client: <strong className="text-slate-800">{owner?.name || "Client"}</strong> ({owner?.phone})
                  </div>

                  <div className="text-[11px] text-slate-500 flex items-center gap-3 pt-1">
                    <span>{p.bedrooms || 3} Bedrooms</span>
                    <span>•</span>
                    <span>{p.carpetAreaSqFt || 2000} sq ft</span>
                    <span>•</span>
                    <span className="font-mono text-slate-400">GPS: {p.gpsCoordinates.lat}, {p.gpsCoordinates.lng}</span>
                  </div>
                </div>

                {/* Access & Parking notes for on-site staff */}
                <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  {p.accessNotes && (
                    <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600">
                      <strong className="text-slate-800 flex items-center gap-1">
                        <KeyRound className="h-3 w-3 text-amber-500" />
                        Access:
                      </strong>
                      {p.accessNotes}
                    </div>
                  )}
                  {p.parkingInstructions && (
                    <div className="p-2 rounded bg-slate-50 border border-slate-100 text-slate-600">
                      <strong className="text-slate-800 flex items-center gap-1">
                        <Car className="h-3 w-3 text-blue-500" />
                        Parking:
                      </strong>
                      {p.parkingInstructions}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Register Property Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register Property</DialogTitle>
            <DialogDescription>
              Add a residence or commercial facility to customer's portfolio.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Linked Customer *</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full h-9 rounded-md border border-slate-200 px-3 bg-white"
                required
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.phone})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Property Nickname / Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="E.g., Sobha Dream Acres 3BHK"
                required
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Type</label>
                <select
                  value={propertyType}
                  onChange={(e) => setPropertyType(e.target.value as any)}
                  className="w-full h-9 rounded-md border border-slate-200 px-2 bg-white"
                >
                  <option value="apartment">Apartment</option>
                  <option value="villa">Villa</option>
                  <option value="duplex">Duplex</option>
                  <option value="penthouse">Penthouse</option>
                  <option value="office">Commercial Office</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-slate-700">Bedrooms</label>
                <Input
                  type="number"
                  value={bedrooms}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setBedrooms(e.target.value === "" ? 0 : Number(e.target.value))}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Full Postal Address *</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Flat / Unit, Tower, Community, Locality..."
                required
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Access Instructions (Gate codes, intercom)</label>
              <Input
                value={accessNotes}
                onChange={(e) => setAccessNotes(e.target.value)}
                placeholder="E.g., Visitor pass code at gate 2"
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Parking Instructions</label>
              <Input
                value={parking}
                onChange={(e) => setParking(e.target.value)}
                placeholder="E.g., Basement 2 visitor parking"
                className="text-xs"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                id="rec"
                checked={recurring}
                onChange={(e) => setRecurring(e.target.checked)}
              />
              <label htmlFor="rec" className="text-slate-700 font-medium">
                Recurring deep cleaning agreement
              </label>
            </div>

            <DialogFooter className="pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="bg-slate-900 text-white">
                Save Property
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
