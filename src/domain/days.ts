// Calendar days. A post's last day is a day in the village's own time zone, not in the time zone
// of the server (which in Google Cloud is UTC).

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDay = (value: string): boolean =>
  ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().startsWith(value);

/** The calendar day a moment falls on in a time zone, «2026-10-18». */
export function dayIn(timeZone: string, moment: number | string = Date.now()): string {
  const date = typeof moment === "string" ? new Date(moment) : new Date(moment);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** A calendar day moved by whole days. Counted at noon in UTC, so no clock change moves it twice. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
