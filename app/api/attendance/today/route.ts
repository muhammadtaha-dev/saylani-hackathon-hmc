import { ok, fail, requireActor } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { currentSettings, deriveStatus } from "@/lib/services/attendance";

// GET /api/attendance/today — check-in widget state
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const today = todayIso();
    if (!actor.employeeId) return ok({ today, record: null, status: "not_checked_in", isLate: false, workedMinutes: null });
    const rec = db.attendance.onDate(actor.employeeId, today);
    const derived = rec ? deriveStatus(actor.employeeId, today, rec, currentSettings()) : null;
    return ok({
      today,
      record: rec ?? null,
      status: derived?.status ?? "not_checked_in",
      isLate: rec?.isLate ?? false,
      workedMinutes: rec?.workedMinutes ?? null,
    });
  } catch (e) {
    return fail(e);
  }
}
