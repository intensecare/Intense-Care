"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { Modal, ErrorText } from "@/components/Modal";
import { useAction } from "@/lib/client/api";
import { toPaise } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Customer                                                                   */
/* -------------------------------------------------------------------------- */

type CustomerValues = { name: string; phone: string; address: string; email: string; notes: string };

export function CustomerFormButton({ customer }: { customer?: { id: string } & CustomerValues }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const blank: CustomerValues = { name: "", phone: "", address: "", email: "", notes: "" };
  const [form, setForm] = useState<CustomerValues>(customer ?? blank);
  const set = (k: keyof CustomerValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      {customer ? (
        <Button variant="ghost" onClick={() => { setForm(customer); setOpen(true); }}>
          Edit
        </Button>
      ) : (
        <Button onClick={() => { setForm(blank); setOpen(true); }}>
          <Plus className="h-5 w-5" /> New Customer
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={customer ? "Edit customer" : "New customer"}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={set("name")} /></Field>
          <Field label="Phone (WhatsApp)"><Input type="tel" inputMode="tel" value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Address"><Textarea value={form.address} onChange={set("address")} /></Field>
          <Field label="Email (optional)"><Input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Notes (optional)"><Textarea value={form.notes} onChange={set("notes")} /></Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              const r = customer ? await run(`/api/customers/${customer.id}`, form, "PATCH") : await run("/api/customers", form);
              if (r.ok) setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff user                                                                 */
/* -------------------------------------------------------------------------- */

const ROLE_OPTIONS = [
  { value: "FIELD_MANAGER", label: "Field Manager" },
  { value: "QC", label: "QC" },
  { value: "ADMIN", label: "Admin" },
];

export function UserFormButton({ user }: { user?: { id: string; name: string; phone: string; role: string; active: boolean } }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "FIELD_MANAGER", password: "", active: true });

  const start = () => {
    setForm(user ? { name: user.name, email: "", phone: user.phone, role: user.role, password: "", active: user.active } : { name: "", email: "", phone: "", role: "FIELD_MANAGER", password: "", active: true });
    setOpen(true);
  };

  return (
    <>
      {user ? (
        <Button variant="ghost" onClick={start}>Edit</Button>
      ) : (
        <Button onClick={start}><Plus className="h-5 w-5" /> New User</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={user ? `Edit ${user.name}` : "New user"}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          {!user && <Field label="Email (sign-in)"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>}
          <Field label="Phone (WhatsApp)" hint="Field managers get new pickups and deliveries on WhatsApp.">
            <Input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </Select>
          </Field>
          <Field label={user ? "New password (leave empty to keep)" : "Password"} hint="At least 8 characters.">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {user && (
            <Field label="Status">
              <Select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
                <option value="1">Active — can sign in</option>
                <option value="0">Disabled — cannot sign in</option>
              </Select>
            </Field>
          )}
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              const r = user
                ? await run(`/api/users/${user.id}`, { name: form.name, phone: form.phone, role: form.role, active: form.active, ...(form.password ? { password: form.password } : {}) }, "PATCH")
                : await run("/api/users", { name: form.name, email: form.email, phone: form.phone, role: form.role, password: form.password });
              if (r.ok) setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Service & price                                                            */
/* -------------------------------------------------------------------------- */

type ServiceValues = { id: string; name: string; description: string | null; unit: string; price: number; turnaroundHours: number; active: boolean; sortOrder: number };

export function ServiceFormButton({ service }: { service?: ServiceValues }) {
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", unit: "PIECE", price: "", turnaroundHours: "48", active: true, sortOrder: "0" });

  const start = () => {
    setForm(
      service
        ? { name: service.name, description: service.description ?? "", unit: service.unit, price: String(service.price / 100), turnaroundHours: String(service.turnaroundHours), active: service.active, sortOrder: String(service.sortOrder) }
        : { name: "", description: "", unit: "PIECE", price: "", turnaroundHours: "48", active: true, sortOrder: "0" }
    );
    setOpen(true);
  };

  return (
    <>
      {service ? <Button variant="ghost" onClick={start}>Edit</Button> : <Button onClick={start}><Plus className="h-5 w-5" /> New Service</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={service ? `Edit ${service.name}` : "New service"}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Dry Clean" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Price (₹)"><Input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></Field>
            <Field label="Per">
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                <option value="PIECE">Piece</option>
                <option value="KG">Kg</option>
                <option value="PAIR">Pair</option>
                <option value="SET">Set</option>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Turnaround (hours)"><Input inputMode="numeric" value={form.turnaroundHours} onChange={(e) => setForm({ ...form, turnaroundHours: e.target.value })} /></Field>
            <Field label="Sort order"><Input inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} /></Field>
          </div>
          <Field label="Description (optional)"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.active ? "1" : "0"} onChange={(e) => setForm({ ...form, active: e.target.value === "1" })}>
              <option value="1">Active — can be added to orders</option>
              <option value="0">Hidden</option>
            </Select>
          </Field>
          <ErrorText error={error} />
          <Button
            size="lg"
            className="w-full"
            disabled={pending}
            onClick={async () => {
              const payload = {
                name: form.name,
                description: form.description || undefined,
                unit: form.unit,
                price: toPaise(Number(form.price) || 0),
                turnaroundHours: Math.max(1, Math.round(Number(form.turnaroundHours) || 48)),
                active: form.active,
                sortOrder: Math.max(0, Math.round(Number(form.sortOrder) || 0)),
              };
              const r = service ? await run(`/api/services/${service.id}`, payload, "PATCH") : await run("/api/services", payload);
              if (r.ok) setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </Modal>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export interface SettingsValues {
  businessName: string;
  supportPhone: string;
  supportWhatsApp: string;
  supportEmail: string;
  businessAddress: string;
  orderPrefix: string;
  taxPercent: number;
  upiId: string;
  autoAssign: boolean;
  notifyCustomers: boolean;
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const { run, pending, error } = useAction();
  const [form, setForm] = useState({ ...initial, taxPercent: String(initial.taxPercent) });
  const [saved, setSaved] = useState(false);
  const text = (k: keyof SettingsValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm({ ...form, [k]: e.target.value });
  };

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business name"><Input value={form.businessName} onChange={text("businessName")} /></Field>
        <Field label="Order ID prefix" hint="1–4 capital letters, e.g. AC → AC1024"><Input value={form.orderPrefix} onChange={text("orderPrefix")} /></Field>
        <Field label="Support phone"><Input type="tel" value={form.supportPhone} onChange={text("supportPhone")} /></Field>
        <Field label="Support WhatsApp"><Input type="tel" value={form.supportWhatsApp} onChange={text("supportWhatsApp")} /></Field>
        <Field label="Support email"><Input type="email" value={form.supportEmail} onChange={text("supportEmail")} /></Field>
        <Field label="UPI ID for payments" hint="Shown to customers as a Pay with UPI button."><Input value={form.upiId} onChange={text("upiId")} placeholder="business@upi" /></Field>
        <Field label="Tax %"><Input inputMode="decimal" value={form.taxPercent} onChange={text("taxPercent")} /></Field>
        <Field label="Automatic assignment">
          <Select value={form.autoAssign ? "1" : "0"} onChange={(e) => setForm({ ...form, autoAssign: e.target.value === "1" })}>
            <option value="1">On — assign pickups & deliveries to the least busy field manager</option>
            <option value="0">Off — I assign manually</option>
          </Select>
        </Field>
        <Field label="Customer WhatsApp updates">
          <Select value={form.notifyCustomers ? "1" : "0"} onChange={(e) => setForm({ ...form, notifyCustomers: e.target.value === "1" })}>
            <option value="1">On</option>
            <option value="0">Off</option>
          </Select>
        </Field>
      </div>
      <Field label="Business address"><Textarea value={form.businessAddress} onChange={text("businessAddress")} /></Field>
      <ErrorText error={error} />
      {saved && <p className="text-sm text-brand-700">Settings saved.</p>}
      <Button
        size="lg"
        disabled={pending}
        onClick={async () => {
          const r = await run("/api/settings", { ...form, taxPercent: Number(form.taxPercent) || 0, orderPrefix: form.orderPrefix.trim().toUpperCase() }, "PATCH");
          if (r.ok) setSaved(true);
        }}
      >
        Save settings
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Own password (all staff)                                                   */
/* -------------------------------------------------------------------------- */

export function PasswordForm() {
  const { run, pending, error } = useAction();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [done, setDone] = useState(false);
  return (
    <div className="space-y-3">
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></Field>
      <Field label="New password" hint="At least 8 characters."><Input type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></Field>
      <ErrorText error={error} />
      {done && <p className="text-sm text-brand-700">Password changed.</p>}
      <Button
        className="w-full"
        disabled={pending || !form.currentPassword || form.newPassword.length < 8}
        onClick={async () => {
          const r = await run("/api/me/password", form);
          if (r.ok) {
            setDone(true);
            setForm({ currentPassword: "", newPassword: "" });
          }
        }}
      >
        Change password
      </Button>
    </div>
  );
}
