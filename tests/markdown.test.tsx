// Intense AI answers stream in piece by piece: every partial prefix must
// render (a half-received table row once froze the page).
import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/ai/Markdown";

const FULL = "### What the data shows\n- **Jobs:** 14 booked\n- Rework mostly in *Bathroom*\n\n| Area | Rework |\n|---|---|\n| Bathroom | 3 |\n| Kitchen | 1 |\n\n### Recommendations\n1. Add a `photo` check\n2. Review the checklist";

test("every streamed prefix of an answer renders", () => {
  for (let n = 0; n <= FULL.length; n++) renderToStaticMarkup(<Markdown text={FULL.slice(0, n)} />);
  for (const t of ["|", "| a |", "| a |\n", "###", "1.", "-", "**", "* x", "|---|", "\n\n|\n", "``"]) renderToStaticMarkup(<Markdown text={t} />);
});

test("headings, lists, tables and inline styles render as elements (no raw HTML)", () => {
  const html = renderToStaticMarkup(<Markdown text={FULL + "\n\n<script>alert(1)</script>"} />);
  assert.ok(html.includes("<table") && html.includes("<ol") && html.includes("<ul") && html.includes("<strong") && html.includes("<code"));
  assert.ok(!html.includes("<script>"), "HTML in an answer is shown as text, never executed");
});
