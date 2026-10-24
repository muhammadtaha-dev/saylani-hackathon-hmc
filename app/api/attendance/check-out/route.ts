import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";
import { todayIso } from "@/lib/dates";
import { assertCanCheckOut, workedMinutesBetween } from "@/lib/services/attendance";

// POST /api/attendance/check-out — requires today's check-in (422), 409 on second.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    if (!actor.employeeId) {
      throw new ApiError(422, "RULE_VIOLATION", "Your account has no employee record, so check-out is unavailable.");
    }
    const today = todayIso();
    const rec = db.attendance.onDate(actor.employeeId, today);
    assertCanCheckOut(rec);
    const now = new Date().toISOString();
    if (now < (rec!.checkIn as string)) {
      throw new ApiError(422, "RULE_VIOLATION", "Check-out cannot be before check-in.");
    }
    const minutes = workedMinutesBetween(rec!.checkIn as string, now);
    const after = db.attendance.update(rec!.id, {
      checkOut: now,
      workedMinutes: minutes,
      updatedAt: nowIso(),
    });
    await db.attendance.flush();
    await audit(actor, "check_out", "attendance", rec!.id, rec, after);
    return ok({ record: after });
  } catch (e) {
    return fail(e);
  }
}
