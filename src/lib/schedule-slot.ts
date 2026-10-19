/** "09:00 - 13:00" or "9:30 AM - 1:00 PM" → minutes after midnight of the start time, or null. */
export function slotStartMinutes(slot: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(slot);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (m[3]) {
    const pm = m[3].toUpperCase() === "PM";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return h > 23 || min > 59 ? null : h * 60 + min;
}

