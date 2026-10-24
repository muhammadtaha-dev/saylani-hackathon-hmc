// Leave rules: working-day counting (skip weekends + holidays), balance math,
// overlap detection, year-split quota consumption. Pure functions + service.
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { eachDayIso, weekdayOfIso, isValidIsoDate, diffDaysIso, todayIso } from "@/lib/dates";

export function weekendDays(): number[] {
  return db.settings.latest()?.weekend ?? [0, 6];
}

// Count days that are neither weekend nor holiday (FR-M5-01).
export function workingDaysBetween(startIso: string, endIso: string, weekend: number[] = weekendDays()): number {
  const holidays = new Set(db.holidays.all().map((h) => h.date));
  let count = 0;
  for (const day of eachDayIso(startIso, endIso)) {
    if (weekend.includes(weekdayOfIso(day))) continue;
    if (holidays.has(day)) continue;
    count++;
  }
  return count;
}

// Split working days per calendar year (FR-M5-06).
export function yearSplit(startIso: string, endIso: string, weekend: number[] = weekendDays()): Record<string, number> {
  const holidays = new Set(db.holidays.all().map((h) => h.date));
  const split: Record<string, number> = {};
  for (const day of eachDayIso(startIso, endIso)) {
    if (weekend.includes(weekdayOfIso(day))) continue;
    if (holidays.has(day)) continue;
    const year = day.slice(0, 4);
    split[year] = (split[year] || 0) + 1;
  }
  return split;
}

export interface LeaveBalanceRow {
  leaveTypeId: string;
  key: string;
  name: string;
  quota: number | null;
  approved: number;
  pending: number;
  remaining: number | null; // null = unlimited
  isPaid: boolean;
}

// Balance per type for a calendar year. Pending days count toward the
// over-balance check but are shown separately.
export function leaveBalanceFor(employeeId: string, year?: string): LeaveBalanceRow[] {
  const y = year || todayIso().slice(0, 4);
  return db.leaveTypes
    .active()
    .map((t) => {
      const rows = db.leaveRequests
        .all()
        .filter((l) => l.employeeId === employeeId && l.leaveTypeId === t.id && l.status !== "cancelled" && l.status !== "rejected");
      let approved = 0;
      let pending = 0;
      for (const l of rows) {
        const days = l.yearSplit[y] ?? 0;
        if (l.status === "approved") approved += days;
        if (l.status === "pending") pending += days;
      }
      const remaining = t.quota === null ? null : Math.max(0, t.quota - approved - pending);
      return { leaveTypeId: t.id, key: t.key, name: t.name, quota: t.quota, approved, pending, remaining, isPaid: t.isPaid };
    });
}

// Validate a leave application. Throws ApiError 422 on rule violations.
export function validateLeaveApplication(input: {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  source: "form" | "ai";
  excludeRequestId?: string;
}): { workingDays: number; yearSplit: Record<string, number>; leaveType: NonNullable<ReturnType<typeof db.leaveTypes.byId>> } {
  const leaveType = db.leaveTypes.byId(input.leaveTypeId);
  if (!leaveType || !leaveType.isActive) {
    throw new ApiError(422, "RULE_VIOLATION", "Selected leave type is not available.");
  }
  if (!isValidIsoDate(input.startDate) || !isValidIsoDate(input.endDate)) {
    throw new ApiError(422, "RULE_VIOLATION", "Dates must be valid YYYY-MM-DD.");
  }
  if (input.startDate > input.endDate) {
    throw new ApiError(422, "RULE_VIOLATION", "Start date must be on or before end date.");
  }
  if (diffDaysIso(input.startDate, input.endDate) > 60) {
    throw new ApiError(422, "RULE_VIOLATION", "Leave requests are limited to 60 calendar days.");
  }
  const today = todayIso();
  // Ruling: past-dated leave allowed only for sick; others must start today or later.
  if (input.startDate < today && leaveType.key !== "sick") {
    throw new ApiError(422, "RULE_VIOLATION", "Only sick leave may be backdated.");
  }

  const days = workingDaysBetween(input.startDate, input.endDate);
  if (days === 0) {
    throw new ApiError(422, "RULE_VIOLATION", "The selected range contains no working days (weekends and holidays are excluded).");
  }
  const split = yearSplit(input.startDate, input.endDate);

  // Overlap with own pending/approved request -> 422 LEAVE_OVERLAP (FR-M5-02)
  const own = db.leaveRequests.all().filter(
    (l) =>
      l.employeeId === input.employeeId &&
      (l.status === "pending" || l.status === "approved") &&
      l.id !== input.excludeRequestId
  );
  const overlaps = own.some((l) => input.startDate <= l.endDate && input.endDate >= l.startDate);
  if (overlaps) {
    throw new ApiError(422, "LEAVE_OVERLAP", "These dates overlap an existing pending or approved leave request.");
  }

  // Balance check (unpaid / unlimited types have no quota check)
  if (leaveType.quota !== null) {
    const balance = leaveBalanceFor(input.employeeId).find((b) => b.leaveTypeId === input.leaveTypeId);
    const consumed = balance ? balance.approved + balance.pending : 0;
    if (consumed + days > leaveType.quota) {
      throw new ApiError(
        422,
        "INSUFFICIENT_BALANCE",
        `Insufficient ${leaveType.name} balance: requested ${days} day(s) but only ${Math.max(0, leaveType.quota - consumed)} remain.`
      );
    }
  }
  return { workingDays: days, yearSplit: split, leaveType };
}
