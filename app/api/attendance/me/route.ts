import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso, eachDayIso, addDaysIso, weekdayOfIso, isValidIsoDate } from "@/lib/dates";
import { currentSettings, deriveStatus } from "@/lib/services/attendance";

// GET /api/attendance/me?from=&to= — own calendar (Employee) or any employee's
// when ?employeeId= is passed by HR/Admin.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const today = todayIso();
    const from = url.searchParams.get("from") || addDaysIso(today, -29);
    const to = url.searchParams.get("to") || today;
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
      throw new ApiError(400, "VALIDATION", "Provide from/to as YYYY-MM-DD with from <= to.");
    }
    let employeeId = actor.employeeId;
    if (actor.role !== "employee") {
      employeeId = url.searchParams.get("employeeId") || employeeId;
    } else if (url.searchParams.get("employeeId") && url.searchParams.get("employeeId") !== actor.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "You can only view your own attendance.");
    }
    const settings = currentSettings();
    const holidays = new Set(db.holidays.all().map((h) => h.date));
    const records = db.attendance.forEmployee(employeeId || "");
    const byDate = new Map(records.map((r) => [r.date, r]));

    const days = eachDayIso(from, to).map((date) => {
      const rec = byDate.get(date);
      const derived = deriveStatus(employeeId || "", date, rec, settings, today);
      return {
        date,
        status: derived.status,
        isLate: rec?.isLate ?? false,
        checkIn: rec?.checkIn ?? null,
        checkOut: rec?.checkOut ?? null,
        workedMinutes: rec?.workedMinutes ?? null,
        isWeekend: settings.weekend.includes(weekdayOfIso(date)),
        isHoliday: holidays.has(date),
      };
    });
    return ok({ from, to, days });
  } catch (e) {
    return fail(e);
  }
}
