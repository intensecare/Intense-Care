/** Business-day boundaries (default IST, UTC+5:30) independent of the server clock. */
const OFFSET_MIN = Number(process.env.BUSINESS_TZ_OFFSET_MINUTES || 330);
const DAY = 24 * 3600 * 1000;

export function dayRange(now = new Date(), daysAgo = 0): { start: Date; end: Date } {
  const off = OFFSET_MIN * 60 * 1000;
  const startLocal = Math.floor((now.getTime() + off) / DAY) * DAY - daysAgo * DAY;
  return { start: new Date(startLocal - off), end: new Date(startLocal - off + (daysAgo + 1) * DAY) };
}
