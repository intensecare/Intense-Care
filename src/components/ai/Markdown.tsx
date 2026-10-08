"use client";

import React from "react";

/**
 * Minimal, safe markdown for Intense AI answers — builds React elements
 * (never injects HTML). Supports headings, paragraphs, bullet and numbered
 * lists, tables, **bold**, *italic* and `code`.
 */
function inline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${keyBase}-${i++}`} className="font-semibold text-zinc-950">{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) out.push(<code key={`${keyBase}-${i++}`} className="rounded bg-zinc-100 px-1 py-0.5 text-[0.9em]">{t.slice(1, -1)}</code>);
    else out.push(<em key={`${keyBase}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <p key={k++} role="heading" aria-level={Math.min(6, level + 1)} className={level <= 2 ? "text-lg font-semibold text-zinc-950 mt-4 first:mt-0" : "text-base font-semibold text-zinc-950 mt-4 first:mt-0"}>
          {inline(h[2].replace(/\*\*/g, ""), `h${k}`)}
        </p>
      );
      i++;
      continue;
    }
    if (trimmed.startsWith("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={k++} className="my-3 overflow-x-auto rounded-xl border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left">
              <tr>{head.map((c, j) => <th key={j} className="px-3 py-2 font-semibold text-zinc-700 whitespace-nowrap">{inline(c, `th${k}${j}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((c, j) => <td key={j} className="px-3 py-2 text-zinc-800 align-top">{inline(c, `td${k}${ri}${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (/^([-*•])\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        if (ordered ? /^\d+[.)]\s+/.test(t) : /^([-*•])\s+/.test(t)) items.push(t.replace(ordered ? /^\d+[.)]\s+/ : /^([-*•])\s+/, ""));
        else if (t && /^\s{2,}/.test(lines[i]) && items.length) items[items.length - 1] += " " + t;
        else break;
        i++;
      }
      const L = ordered ? "ol" : "ul";
      blocks.push(
        <L key={k++} className={ordered ? "my-2 list-decimal pl-6 space-y-1.5" : "my-2 list-disc pl-5 space-y-1.5"}>
          {items.map((it, j) => <li key={j} className="pl-1">{inline(it, `li${k}${j}`)}</li>)}
        </L>
      );
      continue;
    }
    // Always consume at least one line, so a half-streamed table row (or any
    // line no rule above claimed) can never stall the parser.
    const para: string[] = [lines[i++].trim()];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|[-*•]\s|\d+[.)]\s|\|)/.test(lines[i].trim())) para.push(lines[i++].trim());
    blocks.push(<p key={k++} className="my-2 first:mt-0">{inline(para.join(" "), `p${k}`)}</p>);
  }
  return <div className="text-[0.95rem] sm:text-base leading-relaxed text-zinc-800 break-words">{blocks}</div>;
}
