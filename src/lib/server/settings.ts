import { prisma } from "./prisma";

/** Admin-editable business settings (stored in the Setting key/value table). */
export interface Settings {
  businessName: string;
  supportPhone: string;
  supportWhatsApp: string;
  supportEmail: string;
  businessAddress: string;
  orderPrefix: string;
  taxPercent: number;
  upiId: string;
  /** Automatically assign pickups/deliveries to the least-busy field manager. */
  autoAssign: boolean;
  /** Send WhatsApp updates to customers (when WhatsApp is configured). */
  notifyCustomers: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  businessName: "Laundry",
  supportPhone: "",
  supportWhatsApp: "",
  supportEmail: "",
  businessAddress: "",
  orderPrefix: "AC",
  taxPercent: 0,
  upiId: "",
  autoAssign: true,
  notifyCustomers: true,
};

export async function getSettings(): Promise<Settings> {
  const rows = await prisma.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const raw = map.get(key);
    if (raw === undefined) continue;
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === "boolean") (s[key] as boolean) = raw === "true";
    else if (typeof def === "number") (s[key] as number) = Number.isFinite(Number(raw)) ? Number(raw) : def;
    else (s[key] as string) = raw;
  }
  return s;
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const entries = Object.entries(patch).filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined);
  await prisma.$transaction(
    entries.map(([key, value]) =>
      prisma.setting.upsert({ where: { key }, create: { key, value: String(value) }, update: { value: String(value) } })
    )
  );
  return getSettings();
}
