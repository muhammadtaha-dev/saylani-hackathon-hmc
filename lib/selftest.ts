// Executable rule-engine self-test: verifies the acceptance-test math
// (payroll worked example T11, tax boundaries T12, leave working days T07,
// attendance precedence) against the same pure functions the app uses.
// GET /api/selftest (Admin only) -> { passed, failed, results[] }.
import { computePayslip, annualTaxPaisa, monthlyTaxPaisa } from "./services/payroll";
import { deriveStatus, computeIsLate } from "./services/attendance";
import { workingDaysBetween, yearSplit } from "./services/leave";
import { weekdayOfIso, companyTimezone, eachDayIso } from "@/lib/dates";
import type { AttendanceRecord, Settings } from "@/lib/types";

export interface SelfTestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

function fakeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    id: "test",
    officeStart: "09:00",
    graceMinutes: 15,
    halfDayHours: 5,
    weekend: [0, 6],
    officeLat: null,
    officeLng: null,
    radiusMeters: 150,
    effectiveFrom: "2026-01-01",
    createdBy: "test",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function rec(partial: Partial<AttendanceRecord>): AttendanceRecord {
  return {
    id: "t",
    employeeId: "t",
    date: "2026-01-01",
    checkIn: null,
    checkOut: null,
    workedMinutes: null,
    status: null,
    isLate: false,
    source: "web",
    rulesSnapshot: { officeStart: "09:00", graceMinutes: 15, halfDayHours: 5, weekend: [0, 6] },
    createdAt: "",
    updatedAt: "",
    ...partial,
  };
}

export function runSelfTest(): { passed: number; failed: number; results: SelfTestResult[] } {
  const results: SelfTestResult[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push({
      name,
      passed: pass,
      expected: JSON.stringify(expected),
      actual: JSON.stringify(actual),
    });
  };

  // --- T11: Payroll worked example (basic 100,000 PKR = 10,000,000 paisa) ---
  const activity = { workingDays: 22, employedDays: 22, absentDays: 1, unpaidDays: 1, halfDays: 2, lateDays: 0 };
  const slip = computePaislipHelper(10_000_000, activity);
  check("T11 net = 119,545.45 PKR (11,954,545 paisa)", slip.net, 11_954_545);
  check("T11 deductions = 20,454.55 PKR", slip.deductions, 2_045_455);
  check("T11 tax = 10,000 PKR monthly", slip.tax, 1_000_000);
  check("T11 gross = 150,000 PKR", slip.gross, 15_000_000);

  // --- T12: Tax slab boundaries (annual paisa) ---
  check("T12 annual 600,000 -> 0", annualTaxPaisa(60_000_000), 0);
  check("T12 annual 600,001 -> 0.05 PKR (5 paisa)", annualTaxPaisa(60_000_100), 5);
  check("T12 annual 1,200,000 -> 30,000", annualTaxPaisa(120_000_000), 3_000_000);
  check("T12 annual 2,400,000 -> 210,000", annualTaxPaisa(240_000_000), 21_000_000);
  check("T12 annual 3,600,000 -> 510,000", annualTaxPaisa(360_000_000), 51_000_000);
  check("T12 annual 1,800,000 -> 120,000", annualTaxPaisa(180_000_000), 12_000_000);
  check("T12 monthly tax = annual/12 (1,800,000)", monthlyTaxPaisa(180_000_000), 1_000_000);

  // --- T07: Leave working days (Fri->Mon = 2) ---
  // 2026-10-23 is a Friday, 2026-10-26 is the following Monday.
  check("T07 Fri->Mon workingDays = 2", workingDaysBetween("2026-10-23", "2026-10-26"), 2);
  check("T07 Mon->Tue workingDays = 2", workingDaysBetween("2026-10-26", "2026-10-27"), 2);
  check("leave Sat-Sun only = 0", workingDaysBetween("2026-10-24", "2026-10-25", [0, 6]), 0);

  // --- Year split (leave spanning Dec-Jan) ---
  const split = yearSplit("2026-12-28", "2027-01-08", [0, 6]);
  check("year split sums to total working days", (split["2026"] || 0) + (split["2027"] || 0), 10);

  // --- Attendance status precedence (spec §6.1) ---
  const s = fakeSettings();
  const pastDay = "2026-01-05"; // a Monday
  check("precedence: weekend -> non_working", deriveStatus("e", "2026-01-04", undefined, s, "2026-01-06").status, "non_working");
  check("precedence: no record past -> absent", deriveStatus("e", pastDay, undefined, s, "2026-01-06").status, "absent");
  check("precedence: missing checkout -> missing_checkout", deriveStatus("e", pastDay, rec({ checkIn: "2026-01-05T04:00:00Z" }), s, "2026-01-06").status, "missing_checkout");
  check("precedence: worked 4h30 -> half_day", deriveStatus("e", pastDay, rec({ checkIn: "2026-01-05T04:00:00Z", checkOut: "2026-01-05T08:30:00Z", workedMinutes: 270 }), s, "2026-01-06").status, "half_day");
  check("precedence: late check-in -> late", deriveStatus("e", pastDay, rec({ checkIn: "2026-01-05T04:30:00Z", checkOut: "2026-01-05T13:00:00Z", workedMinutes: 510, isLate: true }), s, "2026-01-06").status, "late");
  check("precedence: full day -> present", deriveStatus("e", pastDay, rec({ checkIn: "2026-01-05T04:00:00Z", checkOut: "2026-01-05T13:00:00Z", workedMinutes: 540 }), s, "2026-01-06").status, "present");

  // --- T04: late flag at 09:10 (present) vs 09:20 (late), Asia/Karachi ---
  const tz = companyTimezone();
  // 09:10 PKR = 04:10 UTC (no DST in PKR)
  check("T04 09:10 check-in not late", computeIsLate(new Date("2026-10-19T04:10:00Z"), s, tz), false);
  check("T04 09:20 check-in late", computeIsLate(new Date("2026-10-19T04:20:00Z"), s, tz), true);
  check("T04 09:15 exactly = within grace", computeIsLate(new Date("2026-10-19T04:15:00Z"), s, tz), false);

  // --- Weekend/holiday helpers ---
  check("2026-10-24 is Saturday", weekdayOfIso("2026-10-24"), 6);
  check("next Monday after 2026-10-24 is 2026-10-26", eachDayIso("2026-10-25", "2026-10-26").length, 2);

  // --- Paisa rounding ---
  check("perDay rounding once per line (150000/22*3 = 20454.55)", slip.deductionDays, 3);
  const zeroActivity = { workingDays: 0, employedDays: 0, absentDays: 0, unpaidDays: 0, halfDays: 0, lateDays: 0 };
  const zeroSlip = computePaislipHelper(10_000_000, zeroActivity);
  check("empty month does not crash (net 0)", zeroSlip.net, 0);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  return { passed, failed, results };
}

// Local helper to keep the import list clean (computePayslip signature).
function computePaislipHelper(basicPaisa: number, activity: { workingDays: number; employedDays: number; absentDays: number; unpaidDays: number; halfDays: number; lateDays: number }) {
  return computePayslip(basicPaisa, activity);
}
