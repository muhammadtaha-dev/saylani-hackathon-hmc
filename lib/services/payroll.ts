// Payroll engine (pure functions + orchestration). Money is integer paisa.
// gross = 1.5 x basic · perDay = gross / workingDaysInMonth · base = perDay x
// employedDays (prorate joiners/leavers) · deduction = perDay x (absent +
// unpaid + 0.5 x halfDays) · annual tax by slab on the month's gross ·
// monthlyTax = annualTax / 12 · net = base - deduction - monthlyTax.
// Rounding is half-up, applied once per line. Never floating point storage.
import { db, newId, nowIso } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { eachDayIso, weekdayOfIso, addDaysIso, todayIso } from "@/lib/dates";
import { deriveStatus, currentSettings } from "./attendance";
import type { Payslip, PayrollRun } from "@/lib/types";

// --- Tax slab (annual, PKR thresholds expressed in paisa) ---
// <=600,000 -> 0 · 600,001-1,200,000 -> 5% of excess over 600,000 ·
// 1,200,001-2,400,000 -> 30,000 + 15% of excess over 1,200,000 ·
// 2,400,001-3,600,000 -> 210,000 + 25% of excess over 2,400,000 ·
// above 3,600,000 -> 510,000 + 35% of excess over 3,600,000
export function roundHalfUp(x: number): number {
  // Round to the nearest integer paisa, half up. Guard float artifacts.
  return Math.sign(x) * Math.floor(Math.abs(x) + 0.5 + Number.EPSILON);
}

export function annualTaxPaisa(annualGrossPaisa: number): number {
  if (annualGrossPaisa <= 60_000_000) return 0;
  if (annualGrossPaisa <= 120_000_000) return roundHalfUp(0.05 * (annualGrossPaisa - 60_000_000));
  if (annualGrossPaisa <= 240_000_000) return roundHalfUp(3_000_000 + 0.15 * (annualGrossPaisa - 120_000_000));
  if (annualGrossPaisa <= 360_000_000) return roundHalfUp(21_000_000 + 0.25 * (annualGrossPaisa - 240_000_000));
  return roundHalfUp(51_000_000 + 0.35 * (annualGrossPaisa - 360_000_000));
}

export function monthlyTaxPaisa(annualGrossPaisa: number): number {
  return roundHalfUp(annualTaxPaisa(annualGrossPaisa) / 12);
}

function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function isWorkingDay(dateIso: string, weekend: number[], holidays: Set<string>): boolean {
  return !weekend.includes(weekdayOfIso(dateIso)) && !holidays.has(dateIso);
}

export interface MonthActivity {
  workingDays: number;
  employedDays: number;
  absentDays: number;
  unpaidDays: number;
  halfDays: number;
  lateDays: number;
}

// Attendance/leave activity for one employee for one month (finished days only).
export function monthActivity(employeeId: string, year: number, month: number): MonthActivity {
  const settings = currentSettings();
  const weekend = settings.weekend;
  const holidays = new Set(db.holidays.all().map((h) => h.date));
  const { start, end } = monthBounds(year, month);
  const employee = db.employees.byId(employeeId);
  const today = todayIso();

  // Days already finished: past days, or every day for closed months.
  const isCurrentMonth = start.slice(0, 7) === today.slice(0, 7);
  const countedEnd = isCurrentMonth ? addDaysIso(today, -1) : end;
  const effectiveStart = employee && employee.joinDate > start ? employee.joinDate : start;
  const effectiveEnd =
    employee?.exitDate && employee.exitDate < end ? (employee.exitDate < countedEnd ? employee.exitDate : countedEnd) : countedEnd;

  const attendanceByDate = new Map(db.attendance.forEmployee(employeeId).map((a) => [a.date, a]));
  const unpaidDaysSet = new Set(
    db.leaveRequests
      .all()
      .filter(
        (l) =>
          l.employeeId === employeeId &&
          l.status === "approved" &&
          !db.leaveTypes.byId(l.leaveTypeId)?.isPaid
      )
      .flatMap((l) => eachDayIso(l.startDate, l.endDate))
  );

  let workingDays = 0;
  let employedDays = 0;
  let absentDays = 0;
  let unpaidDays = 0;
  let halfDays = 0;
  let lateDays = 0;

  for (const day of eachDayIso(start, end)) {
    const working = isWorkingDay(day, weekend, holidays);
    if (working) workingDays++;
    if (day < effectiveStart || day > effectiveEnd) continue;
    if (working) employedDays++;

    const rec = attendanceByDate.get(day);
    const derived = deriveStatus(employeeId, day, rec, settings, today);
    if (derived.status === "absent") absentDays++;
    if (derived.status === "half_day") halfDays++;
    if (derived.isLate) lateDays++;
    if (unpaidDaysSet.has(day) && working) unpaidDays++;
  }
  // Unpaid leave on a day already counted absent (no record) must not double-count:
  // absent only counts days with no approved leave; on_leave takes precedence in
  // deriveStatus, so absence and unpaid never overlap. Deduction formula stays:
  // absent + unpaid + 0.5 x halfDays.
  return { workingDays, employedDays, absentDays, unpaidDays, halfDays, lateDays };
}

export interface ComputedPayslip {
  basic: number;
  hra: number;
  medical: number;
  gross: number;
  perDay: number;
  workingDays: number;
  employedDays: number;
  deductionDays: number;
  deductions: number;
  taxableGross: number;
  tax: number;
  net: number;
  daysPaid: number;
  absentDays: number;
  unpaidDays: number;
  halfDays: number;
}

// Pure computation for one employee-month. All inputs paisa.
export function computePayslip(basicPaisa: number, activity: MonthActivity): ComputedPayslip {
  const gross = Math.round(basicPaisa * 1.5);
  const workingDays = activity.workingDays || 1; // guard divide-by-zero (e.g. all-holiday month)
  const perDay = gross / workingDays;
  const base = roundHalfUp(perDay * activity.employedDays);
  const deductionDays = activity.absentDays + activity.unpaidDays + 0.5 * activity.halfDays;
  const deductions = roundHalfUp(perDay * deductionDays);
  // Ruling: tax on the month's gross (full-month basic x 1.5), never on the
  // post-deduction amount. For prorated employees the month's gross is `base`.
  // The slab takes ANNUAL paisa (gross x 12); monthly = annual / 12.
  const taxableGross = Math.max(base, 0);
  const tax = monthlyTaxPaisa(taxableGross * 12);
  const net = base - deductions - tax;
  const hra = Math.round(basicPaisa * 0.4);
  const medical = Math.round(basicPaisa * 0.1);
  return {
    basic: basicPaisa,
    hra,
    medical,
    gross,
    perDay: roundHalfUp(perDay),
    workingDays,
    employedDays: activity.employedDays,
    deductionDays,
    deductions,
    taxableGross,
    tax,
    net,
    daysPaid: Math.max(0, activity.employedDays - deductionDays),
    absentDays: activity.absentDays,
    unpaidDays: activity.unpaidDays,
    halfDays: activity.halfDays,
  };
}

// --- Run lifecycle ---

// Create or regenerate a draft run for all employees employed during the month.
export async function createDraftRun(actor: { userId: string }, year: number, month: number): Promise<PayrollRun> {
  const existing = db.payrollRuns.byMonthYear(month, year);
  if (existing && existing.status === "finalized") {
    throw new ApiError(409, "PAYROLL_LOCKED", "This month's payroll is finalized and cannot be changed.");
  }
  const employees = db.employees.all().filter((e) => {
    const start = e.joinDate;
    const { end } = monthBounds(year, month);
    const exit = e.exitDate ?? "9999-12-31";
    return start <= end && exit >= monthBounds(year, month).start;
  });
  if (employees.length === 0) {
    throw new ApiError(422, "RULE_VIOLATION", "No employees were employed during this month.");
  }

  let run = existing;
  if (!run) {
    run = {
      id: newId(),
      month,
      year,
      status: "draft",
      createdBy: actor.userId,
      finalizedBy: null,
      finalizedAt: null,
      totals: { gross: 0, deductions: 0, tax: 0, net: 0 },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.payrollRuns.insert(run);
  } else {
    db.payrollRuns.update(run.id, { status: "draft", updatedAt: nowIso() });
  }

  const rows: Payslip[] = [];
  const totals = { gross: 0, deductions: 0, tax: 0, net: 0 };
  for (const e of employees) {
    const salary = db.salaryStructures.latestFor(e.id);
    if (!salary) continue;
    // Use the salary effective during the month: latest structure with
    // effectiveFrom <= month end.
    const history = db.salaryStructures
      .all()
      .filter((s) => s.employeeId === e.id && s.effectiveFrom <= monthBounds(year, month).end)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    const active = history[history.length - 1] ?? salary;
    const activity = monthActivity(e.id, year, month);
    const computed = computePayslip(active.basic, activity);
    totals.gross += computed.gross;
    totals.deductions += computed.deductions;
    totals.tax += computed.tax;
    totals.net += computed.net;
    rows.push({
      id: newId(),
      runId: run.id,
      employeeId: e.id,
      month,
      year,
      workingDays: computed.workingDays,
      employedDays: computed.employedDays,
      daysPaid: computed.daysPaid,
      absentDays: computed.absentDays,
      unpaidDays: computed.unpaidDays,
      halfDays: computed.halfDays,
      basic: computed.basic,
      hra: computed.hra,
      medical: computed.medical,
      gross: computed.gross,
      deductionDays: computed.deductionDays,
      deductions: computed.deductions,
      taxableGross: computed.taxableGross,
      tax: computed.tax,
      net: computed.net,
      deductionsJson: {
        absentDays: computed.absentDays,
        unpaidDays: computed.unpaidDays,
        halfDays: computed.halfDays,
        deductionDays: computed.deductionDays,
      },
      createdAt: nowIso(),
    });
  }
  await db.payslips.replaceForRun(run.id, rows);
  db.payrollRuns.update(run.id, { totals, updatedAt: nowIso() });
  await db.payrollRuns.flush();
  await db.payslips.flush();
  const fresh = db.payrollRuns.byId(run.id)!;
  return fresh;
}

export async function finalizeRun(actor: { userId: string }, runId: string): Promise<PayrollRun> {
  const run = db.payrollRuns.byId(runId);
  if (!run) throw new ApiError(404, "NOT_FOUND", "Payroll run not found.");
  if (run.status === "finalized") {
    throw new ApiError(409, "PAYROLL_LOCKED", "Payroll is already finalized.");
  }
  const after = db.payrollRuns.update(runId, {
    status: "finalized",
    finalizedBy: actor.userId,
    finalizedAt: nowIso(),
    updatedAt: nowIso(),
  });
  await db.payrollRuns.flush();
  return after!;
}

export function assertRunMutable(run: PayrollRun): void {
  if (run.status === "finalized") {
    throw new ApiError(409, "PAYROLL_LOCKED", "Finalized payroll is locked and cannot be modified.");
  }
}
