// All "day" computations happen in the company timezone (default Asia/Karachi).
// Instants are stored UTC ISO-8601; calendar dates are YYYY-MM-DD.

export function companyTimezone(): string {
  return process.env.TZ_NAME || "Asia/Karachi";
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function tzFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      weekday: "short",
    });
    partsFormatterCache.set(tz, f);
  }
  return f;
}

export interface ZonedParts {
  date: string; // YYYY-MM-DD
  minutes: number; // minutes since local midnight
  weekday: number; // 0=Sun..6=Sat
  weekdayName: string;
}

export function zonedParts(instant: Date, tz: string = companyTimezone()): ZonedParts {
  const f = tzFormatter(tz);
  const parts = f.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // en-CA may emit 24 for midnight with hour12:false
  const minute = parseInt(get("minute"), 10);
  const wdName = get("weekday"); // Mon, Tue, ...
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    date: `${year}-${month}-${day}`,
    minutes: hour * 60 + minute,
    weekday: wdMap[wdName] ?? 0,
    weekdayName: wdName,
  };
}

export function todayIso(tz: string = companyTimezone()): string {
  return zonedParts(new Date(), tz).date;
}

export function nowMinutesToday(tz: string = companyTimezone()): number {
  return zonedParts(new Date(), tz).minutes;
}

// Parse "HH:MM" -> minutes since midnight
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
}

// "the first Monday strictly after today" etc: iterate dates
export function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function weekdayOfIso(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// "next Monday" ruling: the first `weekday` (0=Sun..6=Sat) strictly after today.
export function nextWeekday(fromIso: string, weekday: number): string {
  let cur = addDaysIso(fromIso, 1);
  for (let i = 0; i < 8; i++) {
    if (weekdayOfIso(cur) === weekday) return cur;
    cur = addDaysIso(cur, 1);
  }
  return addDaysIso(fromIso, 1);
}

export function diffDaysIso(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function eachDayIso(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = startIso;
  let guard = 0;
  while (cur <= endIso && guard < 1000) {
    out.push(cur);
    cur = addDaysIso(cur, 1);
    guard++;
  }
  return out;
}

// Working days of a month per weekend config (used by payroll)
export function workingDaysInMonth(year: number, month: number, weekend: number[]): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month is 1-based here
  let count = 0;
  for (let d = 1; d <= days; d++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (!weekend.includes(weekdayOfIso(iso))) count++;
  }
  return count;
}

// Round half-up to `decimals`, on the PKR scale (input paisa -> paisa)
export function roundHalfUp(value: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  // Guard against float artifacts like 20454.545000000002
  const scaled = Math.round((value * factor + Number.EPSILON) * 1000) / 1000;
  return Math.floor(scaled + 0.5) / factor;
}

export function formatPKR(paisa: number): string {
  const pkr = paisa / 100;
  return `PKR ${pkr.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
