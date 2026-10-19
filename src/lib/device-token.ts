import { createHash, randomBytes } from "node:crypto";

/** The phone's contact-sync token: random, prefixed, and only ever stored as a SHA-256 hash. */

export const TOKEN_PREFIX = "icd_";
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function newDeviceToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}
export const hashDeviceToken = sha256;

