import crypto from "node:crypto";
import { prisma } from "./prisma";
import { HttpError } from "./authz";
import { UPLOAD_MAX_BYTES, UPLOAD_TYPES } from "@/lib/business";

/**
 * Uploads for receipts, bills and HR documents.
 *
 * The browser's claimed type is not trusted: the first bytes of the file must
 * match one of the allowed formats (JPEG, PNG, WebP, PDF), the size is capped,
 * and the file name is reduced to safe characters. Bytes are stored in the
 * database and only ever served through /api/files/[id] after a permission check.
 */

function sniff(buf: Buffer): (typeof UPLOAD_TYPES)[number] | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, "_").replace(/^\.+/, "").slice(0, 100);
  return cleaned || "file";
}

export interface StoreInput {
  file: File;
  ownerType: "expense" | "employee";
  ownerId?: string | null;
  category?: string | null;
  label?: string | null;
  expiresOn?: string | null;
  uploadedBy: string;
}

export async function storeUpload(input: StoreInput) {
  const { file } = input;
  if (!file || typeof file.arrayBuffer !== "function") throw new HttpError(400, "Choose a file to upload.");
  if (file.size === 0) throw new HttpError(400, "That file is empty.");
  if (file.size > UPLOAD_MAX_BYTES) throw new HttpError(413, `That file is too large. The limit is ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, "Only JPEG, PNG, WebP images and PDF files can be uploaded.");
  const row = await prisma.storedFile.create({
    data: {
      ownerType: input.ownerType,
      ownerId: input.ownerId ?? null,
      category: input.category?.slice(0, 40) ?? null,
      label: input.label?.slice(0, 120) ?? null,
      fileName: safeFileName(file.name),
      mimeType: kind, // from the bytes, not from the browser
      sizeBytes: buf.length,
      sha256: crypto.createHash("sha256").update(buf).digest("hex"),
      data: buf,
      expiresOn: input.expiresOn ?? null,
      uploadedBy: input.uploadedBy,
    },
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, category: true, label: true, expiresOn: true, createdAt: true },
  });
  return row;
}
