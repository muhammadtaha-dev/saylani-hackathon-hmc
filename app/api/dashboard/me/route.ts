import { ok, fail, requireActor } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { leaveBalanceFor } from "@/lib/services/leave";
import { deriveStatus, currentSettings } from "@/lib/services/attendance";

// GET /api/dashboard/me — employee personal dashboard: widget state, hours this
// week vs 40h, late count (month), leave balance, last payslip, announcements.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    if (!actor.employeeId) {
      return ok({ empty: true, reason: "no_employee_record", announcements: db.announcements.all().slice(0, 5) });
    }
    const employeeId = actor.employeeId;
    const employee = db.employees.byId(employeeId);
    const today = todayIso();
    const settings = currentSettings();

    // Week window: Monday..Sunday containing today
    const [ty, tm, td] = today.split("-").map(Number);
    const todayUtc = new Date(Date.UTC(ty, tm - 1, td));
    const dow = todayUtc.getUTCDay(); // 0 Sun
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const weekStart = new Date(Date.UTC(ty, tm - 1, td + mondayOffset)).toISOString().slice(0, 10);
    const weekEnd = new Date(Date.UTC(ty, tm - 1, td + mondayOffset + 6)).toISOString().slice(0, 10);

    let minutesThisWeek = 0;
    for (const a of db.attendance.forEmployee(employeeId)) {
      if (a.date >= weekStart && a.date <= weekEnd && a.workedMinutes) minutesThisWeek += a.workedMinutes;
    }

    // Late count this month
    const monthPrefix = today.slice(0, 7);
    let lateThisMonth = 0;
    for (const a of db.attendance.forEmployee(employeeId)) {
      if (a.date.startsWith(monthPrefix) && a.isLate) lateThisMonth++;
    }

    const rec = db.attendance.onDate(employeeId, today);
    const derived = rec ? deriveStatus(employeeId, today, rec, settings) : null;

    const payslips = db.payslips
      .all()
      .filter((p) => p.employeeId === employeeId && db.payrollRuns.byId(p.runId)?.status === "finalized")
      .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
    const lastPayslip = payslips[0] ?? null;

    const balances = leaveBalanceFor(employeeId);
    const upcomingLeave = db.leaveRequests
      .all()
      .filter((l) => l.employeeId === employeeId && (l.status === "pending" || l.status === "approved") && l.endDate >= today)
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    return ok({
      employee: employee
        ? {
            id: employee.id,
            code: employee.code,
            name: `${employee.firstName} ${employee.lastName}`,
            status: employee.status,
            department: employee.departmentId ? db.departments.byId(employee.departmentId)?.name ?? null : null,
            designation: employee.designationId ? db.designations.byId(employee.designationId)?.title ?? null : null,
          }
        : null,
      today: {
        date: today,
        status: derived?.status ?? "not_checked_in",
        checkIn: rec?.checkIn ?? null,
        checkOut: rec?.checkOut ?? null,
        isLate: rec?.isLate ?? false,
        workedMinutes: rec?.workedMinutes ?? null,
      },
      week: { start: weekStart, end: weekEnd, minutes: minutesThisWeek, targetMinutes: 40 * 60 },
      lateThisMonth,
      balances,
      lastPayslip: lastPayslip
        ? { id: lastPayslip.id, month: lastPayslip.month, year: lastPayslip.year, net: lastPayslip.net, gross: lastPayslip.gross }
        : null,
      upcomingLeave,
      announcements: db.announcements.all().slice(0, 5),
    });
  } catch (e) {
    return fail(e);
  }
}
