"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  Eye,
  MapPin,
  Sparkles,
  User,
  UserPlus,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Notice } from "@/components/ui/states";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LocationPicker, type LocationValue } from "@/components/common/LocationPicker";
import { CustomerVisibilityEditor } from "@/components/common/CustomerVisibility";
import { ServiceSelector, toServicePayload, type ServiceDraft } from "@/components/common/ServiceSelector";
import { useApp } from "@/lib/app-context";
import { onDutyWorkerIds } from "@/lib/staff-availability";
import { ASSIGNABLE_ROLES } from "@/lib/rbac";
import { computeDocumentFigures, formatDuration } from "@/lib/documents";
import {
  DEFAULT_CUSTOMER_VISIBILITY,
  normalizeVisibility,
  hiddenCount,
  type CustomerVisibility,
} from "@/lib/visibility";
import { cn, formatDate, formatMoney, formatTimeSlot, toLocalDateOffset } from "@/lib/utils";

/**
 * §10 NEW JOB — eight short steps instead of one long form.
 *
 *   1 Customer   2 Services   3 Location   4 Date & time
 *   5 Field Manager   6 Notes   7 Customer visibility   8 Create
 *
 * Only steps 1-4 can block: a job needs someone to serve, something to do,
 * somewhere to do it and a time. Everything else has a sensible default and
 * can be changed on the job afterwards, so booking stays fast.
 */

const STEPS = [
  { n: 1, label: "Customer", icon: User },
  { n: 2, label: "Services", icon: Sparkles },
  { n: 3, label: "Location", icon: MapPin },
  { n: 4, label: "Date & time", icon: CalendarClock },
  { n: 5, label: "Field Manager", icon: Users },
  { n: 6, label: "Notes", icon: ClipboardList },
  { n: 7, label: "Visibility", icon: Eye },
  { n: 8, label: "Create", icon: Check },
] as const;

const LAST_STEP = 8;

export function NewJobWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    customers,
    properties,
    services,
    users,
    jobs,
    createCustomer,
    createProperty,
    createJob,
    systemSettings,
  } = useApp();

  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* -------------------------------------------------- 1. the customer */
  const [newCustomer, setNewCustomer] = useState(customers.length === 0);
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  /* -------------------------------------------------- 2. the services */
  const [lines, setLines] = useState<ServiceDraft[]>([]);
  const [invoiceType, setInvoiceType] = useState<"GST" | "NON_GST">("GST");
  const [interState, setInterState] = useState(false);

  /* -------------------------------------------------- 3. the location */
  const [location, setLocation] = useState<LocationValue>({ address: "" });

  /* ------------------------------------------------ 4. date and time */
  const [date, setDate] = useState(toLocalDateOffset(1));
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("13:30");
  const timeSlot = `${timeFrom} - ${timeTo}`;

  /* ------------------------------------------------ 5. field manager */
  const [staffIds, setStaffIds] = useState<string[]>([]);

  /* --------------------------------------------------------- 6. notes */
  const [notes, setNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");

  /* ---------------------------------------------------- 7. visibility */
  const [visibility, setVisibility] = useState<CustomerVisibility>(DEFAULT_CUSTOMER_VISIBILITY);

  // The company default is the starting point for every new job.
  useEffect(() => {
    if (!open) return;
    setVisibility(
      normalizeVisibility(systemSettings.defaultCustomerVisibility, DEFAULT_CUSTOMER_VISIBILITY)
    );
  }, [open, systemSettings.defaultCustomerVisibility]);

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerProperties = useMemo(
    () => properties.filter((p) => p.customerId === customerId),
    [properties, customerId]
  );
  const selectedProperty = customerProperties.find((p) => p.id === propertyId);

  // Choosing a customer pre-fills the location from their property on file —
  // Admin confirms or moves the pin rather than typing an address again.
  useEffect(() => {
    if (newCustomer || !selectedProperty) return;
    setLocation((prev) => ({
      address: prev.address || selectedProperty.address || "",
      lat: prev.lat ?? selectedProperty.lat,
      lng: prev.lng ?? selectedProperty.lng,
      notes: prev.notes,
    }));
  }, [newCustomer, selectedProperty]);

  useEffect(() => {
    if (!propertyId && customerProperties.length > 0) setPropertyId(customerProperties[0].id);
  }, [customerProperties, propertyId]);

  const fieldWorkers = users.filter((u) => ASSIGNABLE_ROLES.includes(u.role) && u.active);
  const onDutyIds = useMemo(() => onDutyWorkerIds(jobs), [jobs]);
  const slotConflictIds = useMemo(() => {
    const busy = new Set<string>();
    for (const j of jobs) {
      if (j.scheduledDate !== date || j.scheduledTimeSlot !== timeSlot) continue;
      if (j.status === "COMPLETED" || j.status === "CANCELLED" || j.status === "CLOSED") continue;
      for (const id of j.assignedStaffIds || []) busy.add(id);
    }
    return busy;
  }, [jobs, date, timeSlot]);

  const figures = useMemo(
    () =>
      computeDocumentFigures({
        invoiceType,
        lines: lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discount,
          taxable: l.taxTreatment !== "EXEMPT",
          durationHours: l.durationHours,
        })),
        gstRatePercent: systemSettings.taxRatePercent,
        interState,
      }),
    [lines, invoiceType, interState, systemSettings.taxRatePercent]
  );

  /* ----------------------------------------------------- navigation */
  const stepProblem = (n: number): string | null => {
    if (n === 1) {
      if (newCustomer) {
        if (!name.trim()) return "Enter the customer name.";
        if (phone.trim().length < 7) return "Enter a phone number we can reach them on.";
        return null;
      }
      if (!customerId) return "Choose the customer.";
      if (customerProperties.length > 0 && !propertyId) return "Choose which property this job is for.";
      return null;
    }
    if (n === 2 && lines.length === 0) return "Add at least one service.";
    if (n === 3 && !location.address.trim()) return "Enter the service address.";
    if (n === 4) {
      if (!date) return "Pick the service date.";
      if (!timeFrom || !timeTo) return "Set the start and end of the service window.";
      if (timeFrom >= timeTo) return "The end time must be after the start time.";
      return null;
    }
    return null;
  };

  const next = () => {
    const problem = stepProblem(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStep((s) => Math.min(LAST_STEP, s + 1));
  };

  const back = () => {
    setError(null);
    setStep((s) => Math.max(1, s - 1));
  };

  const reset = () => {
    setStep(1);
    setError(null);
    setLines([]);
    setLocation({ address: "" });
    setNotes("");
    setCustomerNotes("");
    setStaffIds([]);
    setName("");
    setPhone("");
    setEmail("");
    setInvoiceType("GST");
    setInterState(false);
  };

  const submit = async () => {
    for (let n = 1; n <= 4; n++) {
      const problem = stepProblem(n);
      if (problem) {
        setStep(n);
        setError(problem);
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      let targetCustomerId = customerId;
      let targetPropertyId = propertyId;

      if (newCustomer) {
        const created = await createCustomer({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: location.address.trim(),
        });
        if (!created.success || !created.customer) {
          setError(created.message);
          setStep(1);
          return;
        }
        targetCustomerId = created.customer.id;

        const prop = await createProperty({
          customerId: targetCustomerId,
          title: `${name.trim().split(" ")[0]} — ${location.address.trim().slice(0, 40)}`,
          address: location.address.trim(),
          lat: location.lat,
          lng: location.lng,
        });
        if (!prop.success || !prop.property) {
          setError(prop.message);
          setStep(1);
          return;
        }
        targetPropertyId = prop.property.id;
      }

      const result = await createJob({
        customerId: targetCustomerId,
        propertyId: targetPropertyId || undefined,
        propertyAddress: location.address.trim(),
        services: toServicePayload(lines),
        location: {
          address: location.address.trim(),
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy,
          notes: location.notes?.trim() || undefined,
        },
        scheduledDate: date,
        scheduledTimeSlot: timeSlot,
        assignedStaffIds: staffIds,
        notes: notes.trim() || undefined,
        customerNotes: customerNotes.trim() || undefined,
        invoiceType,
        interState: invoiceType === "GST" ? interState : false,
        customerVisibility: visibility,
      });

      if (!result.success) {
        setError(result.message);
        return;
      }
      reset();
      onClose();
    } catch {
      setError("Something went wrong while saving the booking. Please retry.");
    } finally {
      setSubmitting(false);
    }
  };

  const current = STEPS[step - 1];
  const hidden = hiddenCount(visibility);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New job</DialogTitle>
          <DialogDescription>
            Step {step} of {LAST_STEP} · {current.label}
          </DialogDescription>
        </DialogHeader>

        {/* Progress — tappable back to any step already passed. */}
        <ol className="flex items-center gap-1" aria-label="Booking steps">
          {STEPS.map((s) => {
            const done = s.n < step;
            const here = s.n === step;
            return (
              <li key={s.n} className="flex-1">
                <button
                  type="button"
                  onClick={() => done && setStep(s.n)}
                  disabled={!done}
                  aria-current={here ? "step" : undefined}
                  className={cn(
                    "w-full h-1.5 rounded-full transition-colors",
                    done ? "bg-emerald-500" : here ? "bg-rose-500" : "bg-zinc-200"
                  )}
                >
                  <span className="sr-only">
                    {s.label}
                    {done ? " — done" : here ? " — current" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="space-y-5 py-1">
          {error && <Notice tone="error">{error}</Notice>}

          {/* ------------------------------------------- 1. CUSTOMER */}
          {step === 1 && (
            <section className="space-y-4">
              {customers.length > 0 && (
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-zinc-100">
                  <h3 className="text-sm font-medium text-zinc-800">Who is this job for?</h3>
                  <button
                    type="button"
                    onClick={() => setNewCustomer((v) => !v)}
                    className="h-10 px-2 text-sm font-semibold text-rose-600 inline-flex items-center gap-1"
                  >
                    {newCustomer ? (
                      "Choose existing"
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" aria-hidden /> New customer
                      </>
                    )}
                  </button>
                </div>
              )}

              {newCustomer || customers.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Customer name" required>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rahul Sharma" autoFocus />
                  </Field>
                  <Field label="Phone" required hint="The customer link is sent here.">
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+91 98860 12345"
                      inputMode="tel"
                      className="font-mono"
                    />
                  </Field>
                  <Field label="Email" className="sm:col-span-2" hint="Optional.">
                    <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" inputMode="email" />
                  </Field>
                  <p className="sm:col-span-2 text-sm text-zinc-500">
                    The property is created from the service address you pick in step 3.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <Field label="Customer" required>
                    <SearchableSelect
                      value={customerId}
                      onChange={(v) => {
                        setCustomerId(v);
                        const first = properties.find((p) => p.customerId === v);
                        setPropertyId(first?.id ?? "");
                      }}
                      options={customers.map((c) => ({ value: c.id, label: `${c.name} (${c.phone})` }))}
                      placeholder="Search by name or phone"
                    />
                  </Field>
                  {customerId && (
                    <Field
                      label="Property"
                      hint={
                        customerProperties.length === 0
                          ? "No property on file — the address you pick in step 3 becomes one."
                          : "The service location starts from this property and can be adjusted."
                      }
                    >
                      <SearchableSelect
                        value={propertyId}
                        onChange={setPropertyId}
                        options={customerProperties.map((p) => ({ value: p.id, label: `${p.title} - ${p.address}` }))}
                        placeholder="Select the property"
                        emptyMessage="No properties registered for this customer"
                      />
                    </Field>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ------------------------------------------- 2. SERVICES */}
          {step === 2 && (
            <section className="space-y-4">
              <ServiceSelector
                services={services}
                value={lines}
                onChange={setLines}
                gst={invoiceType === "GST"}
                taxRatePercent={systemSettings.taxRatePercent}
                interState={interState}
              />

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-zinc-800">Invoice</legend>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Invoice type">
                  {(["GST", "NON_GST"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={invoiceType === t}
                      onClick={() => setInvoiceType(t)}
                      className={cn(
                        "min-h-12 rounded-xl border-2 px-3 text-sm sm:text-base font-semibold",
                        invoiceType === t
                          ? "border-rose-500 bg-rose-50 text-rose-700"
                          : "border-zinc-200 bg-white text-zinc-700"
                      )}
                    >
                      {t === "GST" ? "GST Invoice" : "Non-GST Invoice"}
                    </button>
                  ))}
                </div>
                {invoiceType === "GST" ? (
                  <label className="flex items-center gap-3 text-sm text-zinc-700 min-h-11">
                    <input
                      type="checkbox"
                      checked={interState}
                      onChange={(e) => setInterState(e.target.checked)}
                      className="h-5 w-5 accent-rose-500"
                    />
                    Customer is in another state (charge IGST instead of CGST + SGST)
                  </label>
                ) : (
                  <p className="text-sm text-zinc-500">No GST is charged on a Non-GST invoice.</p>
                )}
              </fieldset>
            </section>
          )}

          {/* ------------------------------------------- 3. LOCATION */}
          {step === 3 && (
            <section className="space-y-3">
              <p className="text-sm text-zinc-600">
                This becomes the official service location: the crew navigates to it, arrival is GPS-checked against
                it, and it appears on the job QR.
              </p>
              <LocationPicker value={location} onChange={setLocation} />
            </section>
          )}

          {/* ---------------------------------------- 4. DATE & TIME */}
          {step === 4 && (
            <section className="space-y-4">
              <Field label="Service date" required>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="From" required>
                  <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
                </Field>
                <Field
                  label="To"
                  required
                  error={timeFrom && timeTo && timeFrom >= timeTo ? "End must be after start." : null}
                >
                  <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
                </Field>
              </div>
              <p className="text-sm text-zinc-600">
                Service window <strong className="text-zinc-900">{formatTimeSlot(timeSlot)}</strong>
                {figures.durationHours > 0 && <> · estimated work {formatDuration(figures.durationHours)}</>}
              </p>
            </section>
          )}

          {/* ------------------------------------- 5. FIELD MANAGER */}
          {step === 5 && (
            <section className="space-y-3">
              {fieldWorkers.length === 0 ? (
                <p className="text-sm text-zinc-500">No Field Managers yet — add one under Users, or assign later.</p>
              ) : (
                <>
                  <p className="text-sm text-zinc-600">
                    Optional. The first person you pick leads the job. You can assign or change this later.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {fieldWorkers.map((w) => {
                      const selected = staffIds.includes(w.id);
                      const conflict = slotConflictIds.has(w.id);
                      const onDuty = onDutyIds.has(w.id);
                      const availability = conflict ? "Busy at this time" : onDuty ? "On another job" : "Free";
                      return (
                        <button
                          key={w.id}
                          type="button"
                          aria-pressed={selected}
                          onClick={() =>
                            setStaffIds((prev) =>
                              prev.includes(w.id) ? prev.filter((x) => x !== w.id) : [...prev, w.id]
                            )
                          }
                          className={cn(
                            "min-h-11 px-3.5 py-2 rounded-xl text-sm font-medium border inline-flex items-center gap-2 text-left transition-colors",
                            selected
                              ? "bg-zinc-900 text-white border-zinc-900"
                              : "bg-white text-zinc-800 border-zinc-300 hover:bg-zinc-50"
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "h-2.5 w-2.5 rounded-full shrink-0",
                              conflict ? "bg-red-500" : onDuty ? "bg-amber-500" : "bg-emerald-500"
                            )}
                          />
                          <span>
                            {w.name}
                            {selected && staffIds[0] === w.id && staffIds.length > 1 && " · Lead"}
                            <span
                              className={cn(
                                "block text-xs",
                                selected ? "text-zinc-300" : conflict ? "text-red-700" : onDuty ? "text-amber-700" : "text-zinc-500"
                              )}
                            >
                              {availability}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </section>
          )}

          {/* ---------------------------------------------- 6. NOTES */}
          {step === 6 && (
            <section className="space-y-4">
              <Field
                label="Notes for the team"
                htmlFor="nj-notes"
                hint="Internal. Access, focus areas, anything the crew should know. The customer never sees this."
              >
                <textarea
                  id="nj-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Focus on kitchen grease and master bath limescale"
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                />
              </Field>
              <Field
                label="Note for the customer"
                htmlFor="nj-cnotes"
                hint="Optional, and shown on their service page when Service notes is switched on."
              >
                <textarea
                  id="nj-cnotes"
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Please keep the balcony door unlocked for the team"
                  className="w-full rounded-xl border border-zinc-300 px-3.5 py-2.5 text-sm"
                />
              </Field>
            </section>
          )}

          {/* ----------------------------------------- 7. VISIBILITY */}
          {step === 7 && (
            <section className="space-y-3">
              <p className="text-sm text-zinc-600">
                What this customer sees on their QR page. Internal information is never shown, whatever is set here.
              </p>
              <CustomerVisibilityEditor value={visibility} onChange={setVisibility} />
            </section>
          )}

          {/* --------------------------------------------- 8. CREATE */}
          {step === 8 && (
            <section className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-800">Check and create</h3>
              <dl className="rounded-xl border border-zinc-200 divide-y divide-zinc-100 overflow-hidden">
                <Review
                  label="Customer"
                  value={newCustomer ? `${name} · ${phone}` : `${selectedCustomer?.name ?? "—"} · ${selectedCustomer?.phone ?? ""}`}
                  onEdit={() => setStep(1)}
                />
                <Review
                  label="Services"
                  value={lines.map((l) => `${l.name}${l.quantity > 1 ? ` ×${l.quantity}` : ""}`).join(", ") || "—"}
                  onEdit={() => setStep(2)}
                />
                <Review
                  label="Location"
                  value={`${location.address || "—"}${location.lat !== undefined ? " · pin set" : " · no pin"}`}
                  onEdit={() => setStep(3)}
                />
                <Review label="When" value={`${formatDate(date)} · ${formatTimeSlot(timeSlot)}`} onEdit={() => setStep(4)} />
                <Review
                  label="Field Manager"
                  value={
                    staffIds.length === 0
                      ? "Assign later"
                      : staffIds.map((id) => users.find((u) => u.id === id)?.name ?? "—").join(", ")
                  }
                  onEdit={() => setStep(5)}
                />
                <Review
                  label="Customer visibility"
                  value={hidden === 0 ? "Everything shareable" : `${hidden} field${hidden === 1 ? "" : "s"} hidden`}
                  onEdit={() => setStep(7)}
                />
                <Review
                  label={invoiceType === "GST" ? `Invoice · GST ${figures.gstRate}%` : "Invoice · Non-GST"}
                  value={formatMoney(figures.total)}
                  onEdit={() => setStep(2)}
                  strong
                />
              </dl>
              <p className="text-sm text-zinc-500">
                The Job ID, the checklist and the one customer QR are created automatically.
              </p>
            </section>
          )}
        </div>

        <DialogFooter>
          {step > 1 ? (
            <Button type="button" variant="outline" onClick={back} disabled={submitting}>
              <ArrowLeft className="h-4 w-4" aria-hidden /> Back
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
          )}
          {step < LAST_STEP ? (
            <Button type="button" onClick={next}>
              Next <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          ) : (
            <Button type="button" onClick={() => void submit()} loading={submitting}>
              {submitting ? "Creating…" : "Create job"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Review({
  label,
  value,
  onEdit,
  strong,
}: {
  label: string;
  value: string;
  onEdit: () => void;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className="text-sm text-zinc-500 shrink-0">{label}</dt>
      <dd className="flex items-baseline gap-2 min-w-0 text-right">
        <span className={cn("text-sm break-words", strong ? "font-semibold text-zinc-950" : "text-zinc-900")}>
          {value}
        </span>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-semibold text-rose-600 underline-offset-4 hover:underline shrink-0"
        >
          Change
        </button>
      </dd>
    </div>
  );
}
