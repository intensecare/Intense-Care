/** A PDF response: inline for previews / browser print, attachment for downloads. Never cached, never indexed. */
export function pdfResponse(bytes: Buffer, filename: string, request: Request): Response {
  const inline = new URL(request.url).searchParams.get("inline") === "1";
  const safe = filename.replace(/[^\w.\- ]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}
