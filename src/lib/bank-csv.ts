/**
 * Bank statement CSV import — pure parsing, no DB/network. There is no live bank-feed integration;
 * this is the only way transactions enter the reconciliation screen (Admin uploads a file their bank
 * gave them). Parsing never invents a row: anything it can't read lands in `errors`, not in `rows`.
 */

export interface ParsedTxnRow {
  txnDate: string; // YYYY-MM-DD
  description: string;
  amount: number; // positive = credit / inflow
  reference: string | null;
  externalId: string;
}

export interface ParseCsvResult {
  rows: ParsedTxnRow[];
  errors: string[];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Accepts DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY. Returns null if unrecognized. */
function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Cheap, deterministic dedupe key for a statement line that has no bank-assigned reference. */
function fallbackId(date: string, description: string, amount: number): string {
  let h = 0;
  const s = `${date}|${description}|${amount.toFixed(2)}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `auto-${h.toString(36)}`;
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "txndate", "transactiondate", "valuedate"],
  description: ["description", "narration", "particulars", "details"],
  amount: ["amount"],
  credit: ["credit", "creditamount", "deposit"],
  debit: ["debit", "debitamount", "withdrawal"],
  reference: ["reference", "ref", "utr", "chequeno", "referenceno", "txnid"],
};

function matchHeader(normalizedHeaders: string[], key: keyof typeof HEADER_ALIASES): number {
  const aliases = HEADER_ALIASES[key];
  for (let i = 0; i < normalizedHeaders.length; i++) {
    if (aliases.includes(normalizedHeaders[i])) return i;
  }
  return -1;
}

/**
 * Parses a bank statement CSV. Expects a header row with some form of Date, Description and either
 * Amount (signed, or positive-only credit column) or separate Credit/Debit columns, plus an optional
 * Reference column. Column names are matched case/space/punctuation-insensitively.
 */
export function parseBankStatementCsv(text: string): ParseCsvResult {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { rows: [], errors: ["The file has no data rows."] };

  const rawHeaders = splitCsvLine(lines[0]);
  const normalizedHeaders = rawHeaders.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const iDate = matchHeader(normalizedHeaders, "date");
  const iDesc = matchHeader(normalizedHeaders, "description");
  const iAmount = matchHeader(normalizedHeaders, "amount");
  const iCredit = matchHeader(normalizedHeaders, "credit");
  const iDebit = matchHeader(normalizedHeaders, "debit");
  const iRef = matchHeader(normalizedHeaders, "reference");

  const errors: string[] = [];
  if (iDate < 0) errors.push('No "Date" column found.');
  if (iDesc < 0) errors.push('No "Description" column found.');
  if (iAmount < 0 && iCredit < 0 && iDebit < 0) errors.push('No "Amount" (or Credit/Debit) column found.');
  if (errors.length) return { rows: [], errors };

  const rows: ParsedTxnRow[] = [];
  const seen = new Set<string>();
  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsvLine(lines[li]);
    const rowNo = li + 1;
    const dateRaw = cols[iDate] ?? "";
    const txnDate = normalizeDate(dateRaw);
    if (!txnDate) { errors.push(`Row ${rowNo}: unreadable date "${dateRaw}".`); continue; }
    const description = (cols[iDesc] ?? "").slice(0, 300) || "(no description)";
    let amount: number;
    if (iAmount >= 0) {
      amount = Number((cols[iAmount] ?? "").replace(/[,₹\s]/g, ""));
    } else {
      const credit = Number((cols[iCredit] ?? "0").replace(/[,₹\s]/g, "") || "0");
      const debit = Number((cols[iDebit] ?? "0").replace(/[,₹\s]/g, "") || "0");
      amount = credit - debit;
    }
    if (!Number.isFinite(amount) || amount === 0) { errors.push(`Row ${rowNo}: unreadable or zero amount.`); continue; }
    const reference = iRef >= 0 ? (cols[iRef]?.trim() || null) : null;
    const externalId = reference || fallbackId(txnDate, description, amount);
    if (seen.has(externalId)) { errors.push(`Row ${rowNo}: duplicate of another row in this file — skipped.`); continue; }
    seen.add(externalId);
    rows.push({ txnDate, description, amount: Math.round(amount * 100) / 100, reference, externalId });
  }
  return { rows, errors };
}
