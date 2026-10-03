"use client";

import React, { useState, useMemo } from "react";
import { AdminLayout } from "@/components/common/AdminLayout";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { useApp } from "@/lib/app-context";
import { formatCurrency } from "@/lib/utils";
import {
  Users,
  Search,
  Plus,
  Phone,
  Mail,
  Building2,
  Share2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function CustomersPage() {
  const { customers, properties, jobs, partners, createCustomer } = useApp();

  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [address, setAddress] = useState("");
  const [source, setSource] = useState("direct");
  const [partnerId, setPartnerId] = useState("");
  const [notes, setNotes] = useState("");

  // Partner options for dropdown
  const partnerOptions = useMemo(() => [
    { value: "", label: "Direct / None" },
    ...partners.map((p) => ({ value: p.id, label: `${p.name} (${p.code})` })),
  ], [partners]);

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) return;
    setIsSubmitting(true);

    const result = await createCustomer({
      name,
      phone,
      email,
      whatsapp: whatsapp || phone,
      address,
      source,
      referralPartnerId: partnerId || undefined,
      notes,
    });
    if (!result.success) {
      setIsSubmitting(false);
      return;
    }

    setIsCreateOpen(false);
    setName("");
    setPhone("");
    setEmail("");
    setAddress("");
    setNotes("");
    setIsSubmitting(false);
  };

  return (
    <AdminLayout>
      <PageHeader
        title="Customer Directory & Multi-Property Accounts"
        description="Client contact records, WhatsApp routing, registered property portfolios, lifetime value, and referral source attribution."
        breadcrumbs={[
          { label: "Operations", href: "/" },
          { label: "Customers" },
        ]}
        actions={
          <Button
            onClick={() => setIsCreateOpen(true)}
            size="sm"
            className="h-9 gap-1.5 bg-slate-900 text-white font-medium"
          >
            <Plus className="h-4 w-4" />
            Register Customer
          </Button>
        }
      />

      {/* Search Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 mb-5 shadow-xs">
        <div className="relative max-w-md">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by customer name, phone, or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 bg-slate-50 border-slate-200"
          />
        </div>
      </div>

      {/* Customers List */}
      <div className="space-y-4">
        {filteredCustomers.length === 0 ? (
          <EmptyState
            icon={Users}
            title={customers.length === 0 ? "No customers registered yet" : "No customers match your search"}
            description={
              customers.length === 0
                ? "Register residential or commercial property owners to track bookings, address access notes, and WhatsApp communication."
                : "Try clearing your search query or registering a new customer."
            }
            actionLabel="Register Customer"
            onAction={() => setIsCreateOpen(true)}
          />
        ) : (
          filteredCustomers.map((c) => {
            const custProps = properties.filter((p) => p.customerId === c.id);
            const custJobs = jobs.filter((j) => j.customerId === c.id);
            const partner = partners.find((p) => p.id === c.referralPartnerId);

            return (
              <div
                key={c.id}
                className="bg-white rounded-lg border border-slate-200 p-5 shadow-xs hover:border-slate-300 transition-all space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-base">{c.name}</span>
                      <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 uppercase">
                        {c.status}
                      </span>
                      {partner && (
                        <span className="px-2 py-0.2 rounded text-[10px] font-semibold bg-purple-50 text-purple-700 flex items-center gap-1">
                          <Share2 className="h-2.5 w-2.5" />
                          Ref: {partner.code}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex items-center gap-4 flex-wrap">
                      <span className="flex items-center gap-1 font-mono text-slate-700">
                        <Phone className="h-3 w-3 text-slate-400" />
                        {c.phone}
                      </span>
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3 text-slate-400" />
                        {c.email}
                      </span>
                      <span className="text-slate-400">Source: {c.source}</span>
                    </div>
                  </div>

                  <div className="text-left sm:text-right">
                    <div className="text-xs text-slate-400">Lifetime Revenue</div>
                    <div className="text-base font-bold text-slate-900">
                      {formatCurrency(c.lifetimeRevenue)}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {custJobs.length} Bookings Completed
                    </div>
                  </div>
                </div>

                {/* Registered Properties Grid */}
                <div className="space-y-2">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Registered Properties ({custProps.length})
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {custProps.map((p) => (
                      <div
                        key={p.id}
                        className="p-3 rounded-lg border border-slate-100 bg-slate-50/70 text-xs space-y-1"
                      >
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <Building2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                          {p.title}
                        </div>
                        <p className="text-[11px] text-slate-500 leading-relaxed truncate">
                          {p.address}
                        </p>
                        <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                          <span className="capitalize">{p.propertyType} • {p.bedrooms || 3} BHK</span>
                          {p.recurringService && (
                            <span className="text-blue-600 font-semibold">
                              Recurring: {p.recurringFrequency}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {c.notes && (
                  <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100">
                    <strong>Notes:</strong> {c.notes}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Register Customer Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register Customer</DialogTitle>
            <DialogDescription>
              Add customer profile and configure referral attribution.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSubmit} className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Customer Full Name *</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="E.g. Siddharth Rao"
                required
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Phone (OTP & Notifications) *</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98860 12345"
                required
                className="text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Email Address</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="siddharth@example.com"
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Primary Billing Address</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Bengaluru residence address..."
                className="text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Referral Partner Attribution</label>
              <SearchableSelect
                value={partnerId}
                onChange={setPartnerId}
                options={partnerOptions}
                placeholder="Direct / None"
              />
            </div>

            <div className="space-y-1">
              <label className="font-semibold text-slate-700">Customer Preferences / Notes</label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="E.g. Prefers eco chemicals..."
                className="text-xs"
              />
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
              <Button type="submit" size="sm" className="bg-slate-900 text-white" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save Customer"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
