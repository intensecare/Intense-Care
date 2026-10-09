import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { userNames } from "./biz";
import { phoneKey, type EmployeeRow } from "@/lib/business";

export const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");
const list = (max: number) => z.array(z.string().trim().min(1).max(40)).max(max).default([]);

export const EmployeeInput = z
  .object({
    fullName: z.string().trim().min(2, "Enter the full name.").max(160),
    phone: z.string().trim().min(7, "Enter a phone number.").max(20),
    email: z.string().trim().email("Enter a valid email.").max(200).optional().nullable().or(z.literal("")),
    address: z.string().trim().max(400).optional().nullable(),
    emergencyContactName: z.string().trim().max(120).optional().nullable(),
    emergencyContactPhone: z.string().trim().max(20).optional().nullable(),
    employmentType: z.enum(["PERMANENT", "CONTRACT", "FREELANCE"]).default("PERMANENT"),
    department: z.string().trim().max(80).optional().nullable(),
    designation: z.string().trim().max(80).optional().nullable(),
    joiningDate: Day.optional().nullable().or(z.literal("")),
    status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "EXITED"]).default("ACTIVE"),
    managerUserId: z.string().max(64).optional().nullable().or(z.literal("")),
    userId: z.string().max(64).optional().nullable().or(z.literal("")),
    skills: list(30),
    serviceCategories: list(20),
    availabilityNotes: z.string().trim().max(500).optional().nullable(),
    preferredLocations: z.string().trim().max(300).optional().nullable(),
    payType: z.enum(["MONTHLY", "DAILY", "HOURLY", "PER_JOB"]).optional().nullable(),
    payRate: z.number().min(0).max(10_000_000).optional().nullable(),
    verificationStatus: z.enum(["PENDING", "VERIFIED", "REJECTED"]).default("PENDING"),
    agreementOnFile: z.boolean().default(false),
    notes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((d, ctx) => {
    if (d.employmentType === "FREELANCE" && d.payType && !["HOURLY", "PER_JOB"].includes(d.payType)) ctx.addIssue({ code: "custom", path: ["payType"], message: "A freelancer is paid per hour or per job." });
    if (d.payType && (d.payRate === null || d.payRate === undefined)) ctx.addIssue({ code: "custom", path: ["payRate"], message: "Enter the agreed rate." });
  });
export type EmployeeInputT = z.infer<typeof EmployeeInput>;

/** Fields only `hr.sensitive` may read or write. */
export const SENSITIVE_FIELDS = ["address", "emergencyContactName", "emergencyContactPhone", "payType", "payRate"] as const;

type EmpRecord = Prisma.EmployeeGetPayload<object>;

export async function serializeEmployees(rows: EmpRecord[], opts: { sensitive: boolean }): Promise<EmployeeRow[]> {
  const names = await userNames(rows.map((r) => r.managerUserId));
  return rows.map((e) => ({
    id: e.id,
    employeeCode: e.employeeCode,
    fullName: e.fullName,
    phone: e.phone,
    email: opts.sensitive ? e.email : null,
    employmentType: e.employmentType,
    department: e.department,
    designation: e.designation,
    joiningDate: e.joiningDate,
    status: e.status,
    managerUserId: e.managerUserId,
    managerName: e.managerUserId ? names.get(e.managerUserId) ?? null : null,
    userId: e.userId,
    skills: e.skills,
    serviceCategories: e.serviceCategories,
    availabilityNotes: e.availabilityNotes,
    preferredLocations: e.preferredLocations,
    verificationStatus: e.verificationStatus,
    agreementOnFile: e.agreementOnFile,
    notes: opts.sensitive ? e.notes : null,
    ...(opts.sensitive ? { address: e.address, emergencyContactName: e.emergencyContactName, emergencyContactPhone: e.emergencyContactPhone, payType: e.payType, payRate: e.payRate } : {}),
  }));
}

/** An existing employee with the same phone number (other than `exceptId`). */
export async function findDuplicateEmployee(phone: string, exceptId?: string) {
  const key = phoneKey(phone);
  if (!key) return null;
  const cands = await prisma.employee.findMany({ where: { phone: { contains: key.slice(-6) }, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true, phone: true, employeeCode: true, fullName: true } });
  return cands.find((c) => phoneKey(c.phone) === key) ?? null;
}

/** The employee ids a Field Manager may see: staff on the jobs assigned to them. */
export async function teamEmployeeIds(userId: string): Promise<string[]> {
  const rows = await prisma.jobAssignment.findMany({ where: { status: { notIn: ["REMOVED", "DECLINED"] }, job: { assignedManagerId: userId } }, select: { employeeId: true } });
  return Array.from(new Set(rows.map((r) => r.employeeId)));
}

/** Present = 1 day, half day = 0.5. */
export const dayWeight = (status: string) => (status === "PRESENT" ? 1 : status === "HALF_DAY" ? 0.5 : 0);
