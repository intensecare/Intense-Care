// Regenerates src/app/opengraph-image.png from public/logo.svg — the preview image platforms
// (WhatsApp, iMessage, Slack, …) show when a customer link or any other page on the ERP is shared.
// A static file is used instead of Next's dynamic `opengraph-image.tsx` + ImageResponse convention:
// the bundled @vercel/og in next@14.2.15 constructs its internal font path with `path.join(import.meta.url, …)`,
// which is not a valid way to join a file:// URL and breaks on Windows (backslashes corrupt the URL) —
// confirmed by reproducing it directly. A pre-rendered PNG sidesteps that renderer entirely and needs
// no per-request work, which fits a logo that doesn't change per page anyway.
//
//   node scripts/generate-og-image.mjs
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIDTH = 1200;
const HEIGHT = 630;
const LOGO_WIDTH = 820;
const LOGO_ASPECT = 993.4 / 282.29; // public/logo.svg viewBox

async function main() {
  const svg = await readFile(join(root, "public", "logo.svg"), "utf8");
  const logoHeight = Math.round(LOGO_WIDTH / LOGO_ASPECT);

  // The logo itself is white/pink and needs a dark backdrop to read. A high density keeps edges crisp
  // when librsvg rasterizes before the resize down to the final composited size.
  const logoPng = await sharp(Buffer.from(svg), { density: 600 })
    .resize({ width: LOGO_WIDTH, height: logoHeight, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const background = `
    <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="bg" cx="50%" cy="35%" r="75%">
          <stop offset="0%" stop-color="#2a2230" />
          <stop offset="60%" stop-color="#16121a" />
          <stop offset="100%" stop-color="#0d0b10" />
        </radialGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
    </svg>`;

  const out = await sharp(Buffer.from(background))
    .composite([{ input: logoPng, left: Math.round((WIDTH - LOGO_WIDTH) / 2), top: Math.round((HEIGHT - logoHeight) / 2) }])
    .png()
    .toBuffer();

  const dest = join(root, "src", "app", "opengraph-image.png");
  await writeFile(dest, out);
  console.log(`Wrote ${dest} (${out.length} bytes, ${WIDTH}x${HEIGHT})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
