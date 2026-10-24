import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError, paginate, paged } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { validateLeaveApplication } from "@/lib/services/leave";

function decorate(l: ReturnType<typeof db.leaveRequests.byId> & object) {
  const e = db.employees.byId(l.employeeId);
  const t = db.leaveTypes.byId(l.leaveTypeId);
  const decider = l.decidedBy ? db.users.byId(l.decidedBy) : null;
  return {
    ...l,
    employeeName: e ? `${e.firstName} ${e.lastName}` : "Unknown",
    employeeCode: e?.code ?? null,
    leaveTypeName: t?.name ?? "Unknown",
    isPaid: t?.isPaid ?? true,
    decidedByName: decider?.name ?? null,
  };
}

// GET /api/leave?status=&employeeId=&page=&limit= — HR/Admin all; Employee own.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    let rows = [...db.leaveRequests.all()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (actor.role === "employee") {
      rows = rows.filter((l) => l.employeeId === actor.employeeId);
    } else {
      const employeeId = url.searchParams.get("employeeId");
      if (employeeId) rows = rows.filter((l) => l.employeeId === employeeId);
    }
    const status = url.searchParams.get("status");
    if (status) rows = rows.filter((l) => l.status === status);
    const page = paginate(rows, url.searchParams.get("page"), url.searchParams.get("limit"));
    return paged({ data: page.data.map(decorate), page: page.page, limit: page.limit, total: page.total });
  } catch (e) {
    return fail(e);
  }
}

const applySchema = z.object({
  leaveTypeId: z.string().min(1),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().trim().min(5, "Please describe the reason (min 5 characters).").max(500),
  source: z.enum(["form", "ai"]).default("form"),
});

// POST /api/leave — apply (workingDays computed server-side; overlap/balance 422)
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    if (!actor.employeeId) {
      throw new ApiError(422, "RULE_VIOLATION", "No employee record is linked to this account.");
    }
    const body = parseBody(applySchema, await readJson(req));
    const validated = validateLeaveApplication({
      employeeId: actor.employeeId,
      leaveTypeId: body.leaveTypeId,
      startDate: body.startDate,
      endDate: body.endDate,
      source: body.source,
    });
    const row = {
      id: newId(),
      employeeId: actor.employeeId,
      leaveTypeId: body.leaveTypeId,
      startDate: body.startDate,
      endDate: body.endDate,
      workingDays: validated.workingDays,
      yearSplit: validated.yearSplit,
      reason: body.reason,
      status: "pending" as const,
      decidedBy: null,
      decisionComment: null,
      source: body.source,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.leaveRequests.insert(row);
    await audit(actor, "create", "leave_request", row.id, null, row);

    // Notify HR users so the inbox lights up.
    const hrs = db.users.all().filter((u) => u.role === "hr" && u.isActive);
    for (const hr of hrs) {
      await notify(hr.id, "leave_request", "New leave request", `${actor.email} requested ${validated.workingDays} day(s) of ${validated.leaveType.name} leave (${row.startDate} to ${row.endDate}).`, row.id);
    }
    return ok(decorate(row), 201);
  } catch (e) {
    return fail(e);
  }
}
