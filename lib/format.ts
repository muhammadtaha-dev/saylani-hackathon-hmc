"use client";

// Consistent formatting: PKR with thousands separators, ISO dates, durations.
export function fmtPKR(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) return "—";
  return `PKR ${(paisa / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function fmtPKRShort(paisa: number | null | undefined): string {
  if (paisa === null || paisa === undefined) return "—";
  const pkr = paisa / 100;
  if (Math.abs(pkr) >= 1_000_000) return `PKR ${(pkr / 1_000_000).toFixed(1)}M`;
  if (Math.abs(pkr) >= 1_000) return `PKR ${(pkr / 1_000).toFixed(0)}k`;
  return `PKR ${pkr.toFixed(0)}`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function fmtMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function monthName(month: number): string {
  return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1] || `M${month}`;
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "no data";
  return `${v}%`;
}
