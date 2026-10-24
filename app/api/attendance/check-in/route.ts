import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";
import { todayIso, companyTimezone } from "@/lib/dates";
import { currentSettings, computeIsLate, rulesSnapshot, assertCanCheckIn } from "@/lib/services/attendance";

// POST /api/attendance/check-in — server-stamped time; one per day (409).
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    if (!actor.employeeId) {
      throw new ApiError(422, "RULE_VIOLATION", "Your account has no employee record, so check-in is unavailable.");
    }
    const employeeId = actor.employeeId;
    const today = todayIso();
    const settings = currentSettings();
    assertCanCheckIn(employeeId, today);

    const now = new Date();
    const isLate = computeIsLate(now, settings);
    void companyTimezone();
    const snapshot = rulesSnapshot(settings);

    const existing = db.attendance.onDate(employeeId, today);
    if (existing) {
      const after = db.attendance.update(existing.id, {
        checkIn: now.toISOString(),
        isLate,
        updatedAt: nowIso(),
      });
      await db.attendance.flush();
      await audit(actor, "check_in", "attendance", existing.id, existing, after);
      return ok({ record: after }, 201);
    }
    const rec = {
      id: newId(),
      employeeId,
      date: today,
      checkIn: now.toISOString(),
      checkOut: null,
      workedMinutes: null,
      status: null,
      isLate,
      source: "web" as const,
      rulesSnapshot: snapshot,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.attendance.insert(rec);
    await audit(actor, "check_in", "attendance", rec.id, null, rec);
    return ok({ record: rec }, 201);
  } catch (e) {
    return fail(e);
  }
}
