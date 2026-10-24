import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { todayIso, isValidIsoDate } from "@/lib/dates";
import { currentSettings, rulesSnapshot } from "@/lib/services/attendance";

// GET /api/attendance/corrections?status= — HR inbox (all) or own list.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    let rows = [...db.corrections.all()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (actor.role === "employee") rows = rows.filter((c) => c.employeeId === actor.employeeId);
    if (status) rows = rows.filter((c) => c.status === status);
    const withNames = rows.map((c) => {
      const e = db.employees.byId(c.employeeId);
      return { ...c, employeeName: e ? `${e.firstName} ${e.lastName}` : "Unknown", employeeCode: e?.code ?? null };
    });
    return ok({ corrections: withNames });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  date: z.string(),
  requestedCheckIn: z.string().datetime().nullable().optional(),
  requestedCheckOut: z.string().datetime().nullable().optional(),
  reason: z.string().trim().min(10, "Reason must be at least 10 characters.").max(500),
});

// POST /api/attendance/corrections — Employee requests a correction (reason >= 10 chars)
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    if (!actor.employeeId) throw new ApiError(422, "RULE_VIOLATION", "No employee record is linked to this account.");
    const body = parseBody(createSchema, await readJson(req));
    if (!isValidIsoDate(body.date)) throw new ApiError(422, "RULE_VIOLATION", "date must be YYYY-MM-DD.");
    if (body.date > todayIso()) throw new ApiError(422, "RULE_VIOLATION", "Corrections can only be requested for past or today's dates.");
    if (!body.requestedCheckIn && !body.requestedCheckOut) {
      throw new ApiError(422, "RULE_VIOLATION", "Provide a requested check-in or check-out time.");
    }
    if (body.requestedCheckIn && body.requestedCheckOut && body.requestedCheckOut < body.requestedCheckIn) {
      throw new ApiError(422, "RULE_VIOLATION", "Requested check-out must be after requested check-in.");
    }
    const row = {
      id: newId(),
      employeeId: actor.employeeId,
      date: body.date,
      requestedCheckIn: body.requestedCheckIn ?? null,
      requestedCheckOut: body.requestedCheckOut ?? null,
      reason: body.reason,
      status: "pending" as const,
      requestedBy: actor.userId,
      decidedBy: null,
      decisionComment: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.corrections.insert(row);
    await audit(actor, "create", "attendance_correction", row.id, null, row);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}

const decisionSchema = z.object({
  approve: z.boolean(),
  comment: z.string().trim().min(1, "A decision comment is required.").max(500),
});

// POST /api/attendance/corrections/decision?id=... — HR approves/rejects.
// Approval writes the attendance record with source=correction and audits before/after.
export async function PUT(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const body = parseBody(decisionSchema, await readJson(req));
    const correction = db.corrections.byId(id);
    if (!correction) throw new ApiError(404, "NOT_FOUND", "Correction request not found.");
    if (correction.status !== "pending") throw new ApiError(422, "RULE_VIOLATION", "This correction was already decided.");

    db.corrections.update(id, {
      status: body.approve ? "approved" : "rejected",
      decidedBy: actor.userId,
      decisionComment: body.comment,
      updatedAt: nowIso(),
    });
    await db.corrections.flush();

    if (body.approve) {
      const settings = currentSettings();
      const existing = db.attendance.onDate(correction.employeeId, correction.date);
      const before = existing ?? null;
      if (existing) {
        db.attendance.update(existing.id, {
          checkIn: correction.requestedCheckIn ?? existing.checkIn,
          checkOut: correction.requestedCheckOut ?? existing.checkOut,
          workedMinutes:
            correction.requestedCheckIn && correction.requestedCheckOut
              ? Math.max(0, Math.round((new Date(correction.requestedCheckOut).getTime() - new Date(correction.requestedCheckIn).getTime()) / 60000))
              : existing.workedMinutes,
          source: "correction",
          updatedAt: nowIso(),
        });
      } else {
        await db.attendance.insert({
          id: newId(),
          employeeId: correction.employeeId,
          date: correction.date,
          checkIn: correction.requestedCheckIn ?? null,
          checkOut: correction.requestedCheckOut ?? null,
          workedMinutes:
            correction.requestedCheckIn && correction.requestedCheckOut
              ? Math.max(0, Math.round((new Date(correction.requestedCheckOut).getTime() - new Date(correction.requestedCheckIn).getTime()) / 60000))
              : null,
          status: null,
          isLate: false,
          source: "correction",
          rulesSnapshot: rulesSnapshot(settings),
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
      await db.attendance.flush();
      await audit(actor, "approve", "attendance_correction", id, before, db.attendance.onDate(correction.employeeId, correction.date));
    } else {
      await audit(actor, "reject", "attendance_correction", id, correction, null);
    }

    // Notification to the employee
    const employee = db.employees.byId(correction.employeeId);
    if (employee) {
      await notify(
        employee.userId,
        "correction_decision",
        body.approve ? "Correction approved" : "Correction rejected",
        body.approve
          ? `Your attendance correction for ${correction.date} was approved.`
          : `Your attendance correction for ${correction.date} was rejected: ${body.comment}`,
        id
      );
    }
    return ok(db.corrections.byId(id));
  } catch (e) {
    return fail(e);
  }
}
