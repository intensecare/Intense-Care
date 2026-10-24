import { prisma } from "@/lib/server/prisma";
import { requirePermission, HttpError } from "@/lib/server/authz";
import { errorResponse } from "@/lib/server/http";
import { MEDIA_ALLOWED } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

/** GET /api/whatsapp/media/[messageId] — a stored customer attachment, only for signed-in staff with `leads.view`. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission("leads.view");
    const media = await prisma.whatsAppMedia.findUnique({ where: { messageId: params.id }, include: { message: { select: { mediaFilename: true } } } });
    const spec = media ? MEDIA_ALLOWED[media.mime] : null;
    if (!media || !spec) throw new HttpError(404, "File not found.");
    const download = new URL(request.url).searchParams.get("download") === "1" || !spec.inline;
    const name = (media.message.mediaFilename ?? `whatsapp-${media.messageId}.${spec.ext}`).replace(/[^\w.\- ]/g, "_").slice(0, 100);
    return new Response(new Uint8Array(media.bytes), {
      headers: {
        "Content-Type": media.mime,
        "Content-Length": String(media.size),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return errorResponse(err, "whatsapp.media.route_error");
  }
}
