import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { amountInWords } from "@/lib/utils";

/**
 * A small A4 document engine on top of pdfkit, shared by the quotation and invoice PDFs so they carry one
 * design language: logo + company header, hairline rules, a ruled items table whose header repeats on every
 * page, a keep-together totals block, and a footer with company contacts and "Page x of y".
 *
 * Every block is MEASURED before it is drawn (heightOfString), and a block that does not fit moves to the next
 * page — nothing is clipped, overlapped or drawn outside the margins. Long unbroken words are wrapped by pdfkit.
 */

export const INK = "#18181B";
export const MUTED = "#6B7280";
export const RULE = "#D4D4D8";
export const SOFT = "#F4F4F5";
export const ACCENT = "#BE123C"; // the app's rose, darkened for print

const PAGE = { w: 595.28, h: 841.89 };
const M = { l: 42, r: 42, t: 40, b: 46 };
export const CONTENT_W = PAGE.w - M.l - M.r;
const FOOT_Y = PAGE.h - 34;
const BOTTOM = PAGE.h - M.b;

const ASSETS = (...p: string[]) => path.join(process.cwd(), "assets", ...p);

/** "₹1,23,456.00" — Indian digit grouping, always two decimals. Falls back to "Rs." when the font has no rupee sign. */
export function inr(n: number, symbol = "₹"): string {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  return `${symbol}${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2026-11-07 → "07 Nov 2026"; ISO timestamps are shown in IST. */
export function dmy(v: string | Date | null | undefined): string {
  if (!v) return "";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `${v.slice(8, 10)} ${MONTHS[Number(v.slice(5, 7)) - 1]} ${v.slice(0, 4)}`;
  const d = new Date(typeof v === "string" ? v : v.getTime());
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
  return dmy(ist);
}

export interface PdfCompany {
  name: string;
  tagline?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  gstin?: string;
  logo?: string; // data URL from Settings (PNG/JPEG); the bundled mark is used otherwise
  signature?: string;
  signatoryName?: string;
}

function dataUrlImage(u?: string): Buffer | null {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(u ?? "");
  return m ? Buffer.from(m[2], "base64") : null;
}
let bundledLogo: Buffer | null | undefined;
function logoBuffer(c: PdfCompany): Buffer | null {
  const own = dataUrlImage(c.logo);
  if (own) return own;
  if (bundledLogo === undefined) {
    try { bundledLogo = fs.readFileSync(ASSETS("brand", "intense-logo-black.png")); } catch { bundledLogo = null; }
  }
  return bundledLogo;
}

export interface Col {
  key: string;
  title: string;
  w: number; // relative width
  align?: "left" | "right" | "center";
}

export class Pdf {
  readonly doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private fonts = { regular: "Helvetica", bold: "Helvetica-Bold" };
  readonly rupee: string;
  private pageNo = 0;
  private continuedTitle = "";
  y = M.t;

  constructor(private company: PdfCompany, meta: { title: string; subject: string }) {
    this.doc = new PDFDocument({ size: "A4", margins: { top: M.t, bottom: 0, left: M.l, right: M.r }, bufferPages: true, compress: true, info: { Title: meta.title, Subject: meta.subject, Author: company.name || "Intense Care", Producer: "Intense Care ERP" } });
    this.doc.on("data", (c: Buffer) => this.chunks.push(c));
    let rupeeOk = false;
    try {
      this.doc.registerFont("Inter", ASSETS("fonts", "Inter-Regular.otf"));
      this.doc.registerFont("Inter-Bold", ASSETS("fonts", "Inter-Bold.otf"));
      this.fonts = { regular: "Inter", bold: "Inter-Bold" };
      rupeeOk = true;
    } catch {
      /* bundled font missing — built-in Helvetica has no rupee sign, so "Rs." is printed instead */
    }
    this.rupee = rupeeOk ? "₹" : "Rs. ";
    this.doc.font(this.fonts.regular);
  }

  /* ----------------------------------------------------------------- text helpers */
  font(bold = false, size = 9.5, color = INK) {
    this.doc.font(bold ? this.fonts.bold : this.fonts.regular).fontSize(size).fillColor(color);
    return this.doc;
  }
  /** Height a text would take at width w with the CURRENT font settings. */
  h(text: string, w: number, opts: PDFKit.Mixins.TextOptions = {}): number {
    return this.doc.heightOfString(text, { width: w, lineGap: 2, ...opts });
  }
  money(n: number) { return inr(n, this.rupee); }

  /** Moves to a new page if `need` points do not fit. */
  ensure(need: number) {
    if (this.y + need > BOTTOM) this.newPage();
  }

  /* ----------------------------------------------------------------- pages */
  private contentStart() { return this.y; }

  /** Page 1: full letterhead. Later pages: slim running header. */
  firstPageHeader(title: string, meta: { label: string; value: string }[]) {
    this.pageNo = 1;
    this.continuedTitle = title;
    const d = this.doc;
    const logo = logoBuffer(this.company);
    const top = M.t;
    let lh = 36;
    if (logo) {
      try {
        const img = (d as unknown as { openImage: (b: Buffer) => { width: number; height: number } }).openImage(logo);
        const w = Math.min(150, (img.width / img.height) * 40);
        lh = w / (img.width / img.height);
        d.image(logo, M.l, top, { width: w });
      } catch { /* unreadable logo — the name below still identifies the company */ }
    }
    // company block, right aligned
    const cw = 250;
    const cx = PAGE.w - M.r - cw;
    let cy = top;
    this.font(true, 12, INK);
    d.text(this.company.name || "Intense Care", cx, cy, { width: cw, align: "right" });
    cy = d.y;
    this.font(false, 8.5, MUTED);
    const lines = [this.company.tagline, this.company.address, [this.company.phone, this.company.email].filter(Boolean).join("  ·  "), this.company.website, this.company.gstin ? `GSTIN ${this.company.gstin}` : ""].filter(Boolean) as string[];
    for (const l of lines) { d.text(l, cx, cy, { width: cw, align: "right", lineGap: 1.5 }); cy = d.y; }
    this.y = Math.max(top + lh, cy) + 8;
    d.moveTo(M.l, this.y).lineTo(PAGE.w - M.r, this.y).lineWidth(1.6).strokeColor(ACCENT).stroke();
    this.y += 10;
    // title + meta
    this.font(true, 22, INK);
    d.text(title, M.l, this.y, { width: 250, characterSpacing: 1 });
    const titleBottom = d.y;
    const mw = 250, mx = PAGE.w - M.r - mw;
    let my = this.y + 2;
    for (const m of meta.filter((x) => x.value)) {
      this.font(false, 8.5, MUTED);
      d.text(m.label, mx, my, { width: 95 });
      this.font(true, 9.5, INK);
      d.text(m.value, mx + 98, my, { width: mw - 98, align: "right" });
      my = Math.max(my + 14, d.y + 3);
    }
    this.y = Math.max(titleBottom, my) + 10;
  }

  newPage() {
    this.doc.addPage();
    this.pageNo++;
    const d = this.doc;
    const logo = logoBuffer(this.company);
    let top = M.t;
    if (logo) { try { d.image(logo, M.l, top - 4, { height: 22 }); } catch { /* ignore */ } }
    this.font(true, 9, INK);
    d.text(`${this.continuedTitle} (continued)`, M.l + 120, top, { width: CONTENT_W - 120, align: "right" });
    top += 22;
    d.moveTo(M.l, top).lineTo(PAGE.w - M.r, top).lineWidth(0.8).strokeColor(RULE).stroke();
    this.y = top + 14;
    this.onNewPage?.();
  }
  onNewPage?: () => void;

  /* ----------------------------------------------------------------- blocks */
  heading(text: string) {
    this.ensure(34);
    this.font(true, 8.5, ACCENT);
    this.doc.text(text.toUpperCase(), M.l, this.y, { width: CONTENT_W, characterSpacing: 0.8 });
    this.y = this.doc.y + 4;
  }

  /** Two side-by-side labelled blocks (e.g. Prepared for / Service address). Blank lines are never printed. */
  twoColumn(left: { heading: string; lines: { text: string; bold?: boolean }[] } | null, right: { heading: string; lines: { text: string; bold?: boolean }[] } | null) {
    const cw = (CONTENT_W - 24) / 2;
    const draw = (blk: NonNullable<typeof left>, x: number, y: number) => {
      this.font(true, 8.5, ACCENT);
      this.doc.text(blk.heading.toUpperCase(), x, y, { width: cw, characterSpacing: 0.8 });
      let yy = this.doc.y + 4;
      for (const l of blk.lines) {
        this.font(!!l.bold, l.bold ? 11 : 9.5, INK);
        this.doc.text(l.text, x, yy, { width: cw, lineGap: 2 });
        yy = this.doc.y + 1;
      }
      return yy;
    };
    const measure = (blk: NonNullable<typeof left>) => {
      let hh = 16;
      for (const l of blk.lines) { this.font(!!l.bold, l.bold ? 11 : 9.5); hh += this.h(l.text, cw) + 1; }
      return hh;
    };
    const blocks = [left, right].filter((b): b is NonNullable<typeof left> => !!b && b.lines.length > 0);
    if (!blocks.length) return;
    this.ensure(Math.max(...blocks.map(measure)) + 6);
    const y0 = this.y;
    let bottom = y0;
    blocks.forEach((b, i) => { bottom = Math.max(bottom, draw(b, M.l + i * (cw + 24), y0)); });
    this.y = bottom + 10;
  }

  /** Ruled table. The header row is drawn again at the top of every continuation page. */
  table(cols: Col[], rows: Record<string, string>[]) {
    const total = cols.reduce((a, c) => a + c.w, 0);
    const widths = cols.map((c) => (c.w / total) * CONTENT_W);
    const xs = widths.reduce<number[]>((acc, w, i) => [...acc, (acc[i] ?? M.l) + w], [M.l]);
    const PADX = 6, PADY = 6;
    const header = () => {
      this.font(true, 8.5, "#FFFFFF");
      this.doc.rect(M.l, this.y, CONTENT_W, 22).fillColor(INK).fill();
      cols.forEach((c, i) => {
        this.font(true, 8.5, "#FFFFFF");
        this.doc.text(c.title, xs[i] + PADX, this.y + 7, { width: widths[i] - PADX * 2, align: c.align ?? "left", lineBreak: false });
      });
      this.y += 22;
    };
    this.ensure(22 + 40);
    header();
    const prev = this.onNewPage;
    this.onNewPage = () => header();
    rows.forEach((r, idx) => {
      this.font(false, 9.5);
      const hh = Math.max(...cols.map((c, i) => this.h(r[c.key] ?? "", widths[i] - PADX * 2, { align: c.align ?? "left" }))) + PADY * 2;
      if (this.y + hh > BOTTOM) this.newPage(); // newPage re-draws the header via onNewPage
      if (idx % 2 === 1) this.doc.rect(M.l, this.y, CONTENT_W, hh).fillColor(SOFT).fill();
      cols.forEach((c, i) => {
        this.font(c.key === "desc" ? false : false, 9.5, INK);
        this.doc.text(r[c.key] ?? "", xs[i] + PADX, this.y + PADY, { width: widths[i] - PADX * 2, align: c.align ?? "left", lineGap: 2 });
      });
      this.y += hh;
      this.doc.moveTo(M.l, this.y).lineTo(PAGE.w - M.r, this.y).lineWidth(0.5).strokeColor(RULE).stroke();
    });
    this.onNewPage = prev;
    this.y += 12;
  }

  /** Right-aligned label / value rows, kept together on one page. `strong` rows are drawn on a dark band. */
  summary(rows: { label: string; value: string; strong?: boolean; muted?: boolean }[], opts: { note?: string } = {}) {
    const w = 250, x = PAGE.w - M.r - w;
    const need = rows.reduce((a, r) => a + (r.strong ? 28 : 17), 0) + (opts.note ? 24 : 0) + 8;
    this.ensure(need);
    for (const r of rows) {
      if (r.strong) {
        this.doc.rect(x, this.y, w, 26).fillColor(INK).fill();
        this.font(true, 11, "#FFFFFF");
        this.doc.text(r.label, x + 10, this.y + 8, { width: 110, lineBreak: false });
        this.doc.text(r.value, x + 100, this.y + 8, { width: w - 110, align: "right", lineBreak: false });
        this.y += 28;
      } else {
        this.font(false, 9.5, r.muted ? MUTED : INK);
        this.doc.text(r.label, x + 10, this.y, { width: 130, lineBreak: false });
        this.font(r.label.startsWith("Balance"), 9.5, r.muted ? MUTED : INK);
        this.doc.text(r.value, x + 100, this.y, { width: w - 110, align: "right", lineBreak: false });
        this.y += 17;
        this.doc.moveTo(x, this.y - 3).lineTo(x + w, this.y - 4).lineWidth(0.4).strokeColor(RULE).stroke();
      }
    }
    if (opts.note) {
      this.font(false, 8, MUTED);
      this.doc.text(opts.note, x, this.y + 2, { width: w, align: "right" });
      this.y = this.doc.y + 6;
    }
    this.y += 6;
  }

  amountWords(total: number) {
    const words = amountInWords(total);
    if (!words) return;
    this.font(false, 9, MUTED);
    const text = `Amount in words: INR ${words} only`;
    this.ensure(this.h(text, CONTENT_W) + 10);
    this.doc.text(text, M.l, this.y, { width: CONTENT_W, lineGap: 2 });
    this.y = this.doc.y + 8;
  }

  /** A titled paragraph block; splits across pages by paragraph so a long terms text never runs off the page. */
  section(title: string, text: string | undefined | null, opts: { size?: number; bullets?: boolean } = {}) {
    const body = (text ?? "").replace(/\r/g, "").trim();
    if (!body) return;
    const size = opts.size ?? 9;
    const paras = body.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    this.font(false, size);
    const first = paras[0];
    this.ensure(26 + Math.min(this.h(opts.bullets ? `•  ${first}` : first, CONTENT_W - (opts.bullets ? 10 : 0)), 60));
    this.heading(title);
    for (const p of paras) {
      this.font(false, size, "#3F3F46");
      const t = opts.bullets ? `•  ${p}` : p;
      const hh = this.h(t, CONTENT_W);
      if (this.y + hh > BOTTOM) this.newPage();
      this.font(false, size, "#3F3F46"); // newPage drew the running header in bold
      this.doc.text(t, M.l, this.y, { width: CONTENT_W, lineGap: 2 });
      this.y = this.doc.y + 2;
    }
    this.y += 5;
  }

  /** Customer acceptance (left) and company signature (right), kept together. */
  signatures(opts: { acceptance: boolean; company: PdfCompany; ack?: string }) {
    const H = opts.acceptance ? 70 : 50;
    this.ensure(H + 6);
    const cw = (CONTENT_W - 30) / 2;
    const y0 = this.y + 6;
    const box = (x: number, title: string, draw?: (x: number) => void) => {
      this.font(true, 8.5, ACCENT);
      this.doc.text(title.toUpperCase(), x, y0, { width: cw, characterSpacing: 0.8 });
      draw?.(x);
      this.doc.moveTo(x, y0 + H - 22).lineTo(x + cw, y0 + H - 22).lineWidth(0.7).strokeColor(INK).stroke();
    };
    if (opts.acceptance) {
      box(M.l, "Customer acceptance", (x) => {
        this.font(false, 8.5, MUTED);
        this.doc.text(opts.ack ?? "I accept this quotation and its terms.", x, y0 + 16, { width: cw });
        this.doc.text("Name, signature & date", x, y0 + H - 18, { width: cw });
      });
    }
    box(M.l + cw + 30, `For ${opts.company.name || "Intense Care"}`, (x) => {
      const sig = dataUrlImage(opts.company.signature);
      if (sig) { try { this.doc.image(sig, x, y0 + 14, { fit: [140, H - 38] }); } catch { /* ignore */ } }
      this.font(false, 8.5, MUTED);
      this.doc.text(opts.company.signatoryName || "Authorised signatory", x, y0 + H - 18, { width: cw });
    });
    this.y = y0 + H + 6;
  }

  /** A pill-style status label. */
  badge(text: string, x: number, y: number, tone: "good" | "warn" | "bad" | "neutral") {
    const col = { good: "#047857", warn: "#B45309", bad: "#B91C1C", neutral: "#52525B" }[tone];
    this.font(true, 8, col);
    const w = this.doc.widthOfString(text, { characterSpacing: 0.6 }) + 16;
    this.doc.roundedRect(x, y, w, 17, 8.5).lineWidth(0.9).strokeColor(col).stroke();
    this.doc.text(text, x + 8, y + 5, { width: w, lineBreak: false, characterSpacing: 0.6 });
    return w;
  }

  /* ----------------------------------------------------------------- finish */
  /** Footer on every page ("Page x of y"), then the finished bytes. */
  async finish(footerNote: string): Promise<Buffer> {
    const range = this.doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      this.doc.switchToPage(range.start + i);
      this.doc.moveTo(M.l, FOOT_Y - 8).lineTo(PAGE.w - M.r, FOOT_Y - 8).lineWidth(0.6).strokeColor(RULE).stroke();
      this.font(false, 7.5, MUTED);
      const line = [this.company.name, this.company.phone, this.company.email, this.company.website].filter(Boolean).join("   |   ");
      this.doc.text(line, M.l, FOOT_Y, { width: CONTENT_W - 70, lineBreak: false, ellipsis: true });
      this.doc.text(`Page ${i + 1} of ${range.count}`, PAGE.w - M.r - 70, FOOT_Y, { width: 70, align: "right", lineBreak: false });
      if (footerNote) this.doc.text(footerNote, M.l, FOOT_Y + 10, { width: CONTENT_W, lineBreak: false, ellipsis: true });
    }
    const done = new Promise<Buffer>((res) => this.doc.on("end", () => res(Buffer.concat(this.chunks))));
    this.doc.end();
    return done;
  }
}
