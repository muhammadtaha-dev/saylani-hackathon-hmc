// Attendance rules: status precedence per Constitution §4.3:
// on_leave > holiday/weekend > absent > missing_checkout > half_day > late > present.
// isLate stored separately so Late % and Attendance rate are both computable.
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { zonedParts, hhmmToMinutes, weekdayOfIso, todayIso, companyTimezone } from "@/lib/dates";
import type { AttendanceRecord, AttendanceStatus, Settings } from "@/lib/types";

export function currentSettings(): Settings {
  const s = db.settings.latest();
  if (s) return s;
  return {
    id: "default",
    officeStart: "09:00",
    graceMinutes: 15,
    halfDayHours: 5,
    weekend: [0, 6],
    officeLat: null,
    officeLng: null,
    radiusMeters: 150,
    effectiveFrom: "1970-01-01",
    createdBy: "system",
    createdAt: "1970-01-01T00:00:00Z",
  };
}

export function isNonWorkingDay(dateIso: string, weekend: number[]): boolean {
  if (weekend.includes(weekdayOfIso(dateIso))) return true;
  return db.holidays.byDate(dateIso) !== undefined;
}

export function hasApprovedLeaveOn(employeeId: string, dateIso: string): boolean {
  return db.leaveRequests
    .all()
    .some((l) => l.employeeId === employeeId && l.status === "approved" && l.startDate <= dateIso && dateIso <= l.endDate);
}

export interface DerivedStatus {
  status: AttendanceStatus;
  isLate: boolean;
}

// Derived status for employee E on date D (spec §6.1).
export function deriveStatus(
  employeeId: string,
  dateIso: string,
  rec: AttendanceRecord | undefined,
  settings: Settings = currentSettings(),
  today: string = todayIso()
): DerivedStatus {
  if (isNonWorkingDay(dateIso, settings.weekend)) return { status: "non_working", isLate: false };
  if (hasApprovedLeaveOn(employeeId, dateIso)) return { status: "on_leave", isLate: false };

  if (!rec) {
    if (dateIso < today) return { status: "absent", isLate: false };
    return { status: dateIso === today ? "checked_in" : "absent", isLate: false };
  }
  if (!rec.checkOut) {
    if (dateIso < today) return { status: "missing_checkout", isLate: rec.isLate };
    return { status: "checked_in", isLate: rec.isLate };
  }
  const worked = rec.workedMinutes ?? 0;
  if (worked < settings.halfDayHours * 60) return { status: "half_day", isLate: rec.isLate };
  if (rec.isLate) return { status: "late", isLate: true };
  return { status: "present", isLate: false };
}

// Compute isLate from the check-in instant + rules snapshot.
export function computeIsLate(checkInInstant: Date, settings: Settings, tz: string = companyTimezone()): boolean {
  const p = zonedParts(checkInInstant, tz);
  const startMin = hhmmToMinutes(settings.officeStart);
  return p.minutes > startMin + settings.graceMinutes;
}

export function rulesSnapshot(settings: Settings) {
  return {
    officeStart: settings.officeStart,
    graceMinutes: settings.graceMinutes,
    halfDayHours: settings.halfDayHours,
    weekend: settings.weekend,
  };
}

// Check-in rules (FR-M4-01): server stamps time; one per day -> 409; weekend/
// holiday check-in allowed but flagged non-working (not late/absent).
export function assertCanCheckIn(employeeId: string, dateIso: string): void {
  const existing = db.attendance.onDate(employeeId, dateIso);
  if (existing && existing.checkIn) {
    throw new ApiError(409, "ALREADY_CHECKED_IN", "You have already checked in today.");
  }
}

// Check-out rules (FR-M4-02): requires today's check-in (else 422); second
// check-out -> 409; check-out before check-in -> 422.
export function assertCanCheckOut(rec: AttendanceRecord | undefined): void {
  if (!rec || !rec.checkIn) throw new ApiError(422, "RULE_VIOLATION", "You need to check in before checking out.");
  if (rec.checkOut) throw new ApiError(409, "ALREADY_CHECKED_OUT", "You have already checked out today.");
}

export function workedMinutesBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn).getTime();
  const b = new Date(checkOut).getTime();
  return Math.max(0, Math.round((b - a) / 60000));
}
