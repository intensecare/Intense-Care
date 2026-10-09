import { z } from "zod";
import { round2 } from "@/lib/business";

export const PayrollInput = z.object({
  basic: z.number().min(0).max(10_000_000),
  allowances: z.number().min(0).max(10_000_000).default(0),
  deductions: z.number().min(0).max(10_000_000).default(0),
  advances: z.number().min(0).max(10_000_000).default(0),
  bonuses: z.number().min(0).max(10_000_000).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** Net payable is always computed here — never trusted from the browser. */
export const netPayable = (p: { basic: number; allowances: number; deductions: number; advances: number; bonuses: number }) => round2(p.basic + p.allowances + p.bonuses - p.deductions - p.advances);
