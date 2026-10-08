import { z } from "zod";

export const CustomerSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(120),
  phone: z.string().trim().min(10, "Enter a valid phone number").max(20),
  address: z.string().trim().min(5, "Address is required").max(500),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().max(1000).optional(),
});

export const ServiceSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(80),
  description: z.string().max(300).optional(),
  unit: z.enum(["PIECE", "KG", "PAIR", "SET"]),
  price: z.number().int().min(0).max(10000000),
  turnaroundHours: z.number().int().min(1).max(720),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
