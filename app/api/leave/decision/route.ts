import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { validateLeaveApplication } from "@/lib/services/leave";

const schema = z.object({
  approve: z.boolean(),
  // Comment is mandatory on REJECT (enforced as a 422 business rule below).
  comment: z.string().trim().max(500).default(""),
});

// POST /api/leave/decision?id=... — HR approves/rejects with mandatory comment;
// revalidates balance/overlap at approval time; notification + audit entry.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const body = parseBody(schema, await readJson(req));
    const leave = db.leaveRequests.byId(id);
    if (!leave) throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
    if (leave.status !== "pending") {
      throw new ApiError(422, "RULE_VIOLATION", `This request was already ${leave.status}.`);
    }
    if (!body.approve && !body.comment) {
      throw new ApiError(422, "RULE_VIOLATION", "A comment is mandatory when rejecting a leave request.");
    }
    if (body.approve) {
      // Revalidate balance/overlap at approval time (FR-M5-05).
      validateLeaveApplication({
        employeeId: leave.employeeId,
        leaveTypeId: leave.leaveTypeId,
        startDate: leave.startDate,
        endDate: leave.endDate,
        source: leave.source,
        excludeRequestId: leave.id,
      });
    }

    db.leaveRequests.update(id, {
      status: body.approve ? "approved" : "rejected",
      decidedBy: actor.userId,
      decisionComment: body.comment,
    });
    await db.leaveRequests.flush();
    await audit(actor, body.approve ? "approve" : "reject", "leave_request", id, { status: "pending" }, {
      status: body.approve ? "approved" : "rejected",
      decisionComment: body.comment,
    });

    const e = db.employees.byId(leave.employeeId);
    if (e) {
      await notify(
        e.userId,
        "leave_decision",
        body.approve ? "Leave approved" : "Leave rejected",
        body.approve
          ? `Your leave (${leave.startDate} to ${leave.endDate}) was approved. Comment: ${body.comment}`
          : `Your leave (${leave.startDate} to ${leave.endDate}) was rejected. Comment: ${body.comment}`,
        id
      );
    }
    return ok(db.leaveRequests.byId(id));
  } catch (e) {
    return fail(e);
  }
}
