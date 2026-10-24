import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso, weekdayOfIso, isValidIsoDate } from "@/lib/dates";
import { currentSettings, deriveStatus } from "@/lib/services/attendance";

// GET /api/attendance/board?date=&departmentId= — HR/Admin daily board listing
// every active employee with derived status for the date.
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const date = url.searchParams.get("date") || todayIso();
    if (!isValidIsoDate(date)) throw new ApiError(400, "VALIDATION", "date must be YYYY-MM-DD.");
    const departmentId = url.searchParams.get("departmentId") || "";
    const settings = currentSettings();
    const today = todayIso();

    let employees = db.employees.all().filter((e) => e.status === "active" || e.status === "probation");
    if (departmentId) employees = employees.filter((e) => e.departmentId === departmentId);
    employees.sort((a, b) => a.code.localeCompare(b.code));

    const rows = employees.map((e) => {
      const rec = db.attendance.onDate(e.id, date);
      const derived = deriveStatus(e.id, date, rec, settings, today);
      const dept = e.departmentId ? db.departments.byId(e.departmentId) : null;
      return {
        employeeId: e.id,
        code: e.code,
        name: `${e.firstName} ${e.lastName}`,
        department: dept?.name ?? null,
        status: derived.status,
        isLate: derived.isLate,
        checkIn: rec?.checkIn ?? null,
        checkOut: rec?.checkOut ?? null,
        workedMinutes: rec?.workedMinutes ?? null,
      };
    });
    const summary = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    return ok({ date, isNonWorking: settings.weekend.includes(weekdayOfIso(date)) || db.holidays.byDate(date) !== undefined, summary, rows });
  } catch (e) {
    return fail(e);
  }
}
