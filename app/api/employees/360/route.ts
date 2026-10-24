import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso, eachDayIso, weekdayOfIso } from "@/lib/dates";
import { leaveBalanceFor } from "@/lib/services/leave";

// GET /api/employees/360?id=... — profile, department, salary (HR/Admin only),
// last 30 days attendance summary, leave balances, latest payslip.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    if (actor.role === "employee" && id !== actor.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "You can only view your own profile.");
    }
    const e = db.employees.byId(id);
    if (!e) throw new ApiError(404, "NOT_FOUND", "Employee not found.");
    const dept = e.departmentId ? db.departments.byId(e.departmentId) : null;
    const desig = e.designationId ? db.designations.byId(e.designationId) : null;
    const manager = e.managerId ? db.employees.byId(e.managerId) : null;

    const canSeeSalary = actor.role === "admin" || actor.role === "hr";
    const salary = canSeeSalary ? db.salaryStructures.latestFor(id) ?? null : null;

    // Last 30 days attendance summary
    const today = todayIso();
    const from = eachDayIso(today, today).length ? addDays(today, -29) : today;
    const range = eachDayIso(from, today);
    const settings = db.settings.latest();
    const weekend = settings?.weekend ?? [0, 6];
    const attendanceByDate = new Map(db.attendance.forEmployee(id).map((a) => [a.date, a]));
    const leaveDays = new Set(
      db.leaveRequests
        .all()
        .filter((l) => l.employeeId === id && l.status === "approved")
        .flatMap((l) => expandApprovedDays(l.startDate, l.endDate))
    );
    const holidayDates = new Set(db.holidays.all().map((h) => h.date));
    let present = 0, late = 0, half = 0, absent = 0, onLeave = 0, nonWorking = 0, missing = 0;
    const calendar = range.map((date) => {
      let status = "non_working";
      const rec = attendanceByDate.get(date);
      if (leaveDays.has(date)) status = "on_leave";
      else if (rec?.checkIn && rec.checkOut) status = rec.workedMinutes !== null && rec.workedMinutes < (settings?.halfDayHours ?? 5) * 60 ? "half_day" : "present";
      else if (rec?.checkIn && rec.isLate) status = "late";
      else if (rec?.checkIn) status = "checked_in";
      else if (weekend.includes(weekdayOfIso(date)) || holidayDates.has(date)) status = "non_working";
      else if (date < today) status = "absent";
      if (status === "present" || status === "checked_in") present++;
      if (status === "late") late++;
      if (status === "half_day") half++;
      if (status === "absent") absent++;
      if (status === "on_leave") onLeave++;
      if (status === "non_working") nonWorking++;
      if (status === "missing_checkout") missing++;
      return { date, status, checkIn: rec?.checkIn ?? null, checkOut: rec?.checkOut ?? null, isLate: rec?.isLate ?? false };
    });

    const latestPayslip = db.payslips
      .all()
      .filter((p) => p.employeeId === id)
      .sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0] ?? null;
    const runFinalized = latestPayslip
      ? db.payrollRuns.byId(latestPayslip.runId)?.status === "finalized"
      : false;

    return ok({
      profile: {
        id: e.id,
        code: e.code,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        address: e.address,
        gender: e.gender,
        dob: e.dob,
        joinDate: e.joinDate,
        exitDate: e.exitDate,
        status: e.status,
      },
      department: dept ? { id: dept.id, name: dept.name } : null,
      designation: desig ? { id: desig.id, title: desig.title } : null,
      manager: manager ? { id: manager.id, name: `${manager.firstName} ${manager.lastName}` } : null,
      salary: salary
        ? {
            basicPaisa: salary.basic,
            hraPaisa: salary.hra,
            medicalPaisa: salary.medical,
            grossPaisa: salary.gross,
            effectiveFrom: salary.effectiveFrom,
          }
        : null,
      attendanceSummary: { from, to: today, present, late, half, absent, onLeave, nonWorking, missing },
      calendar,
      leaveBalances: leaveBalanceFor(id),
      latestPayslip:
        latestPayslip && (actor.role !== "employee" || runFinalized)
          ? { id: latestPayslip.id, month: latestPayslip.month, year: latestPayslip.year, netPaisa: latestPayslip.net, finalized: runFinalized }
          : null,
    });
  } catch (e) {
    return fail(e);
  }
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function expandApprovedDays(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = startIso;
  let guard = 0;
  while (cur <= endIso && guard < 400) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    guard++;
  }
  return out;
}
