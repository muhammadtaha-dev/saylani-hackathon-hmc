import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { todayIso } from "@/lib/dates";

// POST /api/leave/cancel?id=... — owner cancels while pending, or before start
// date once approved (balance restored implicitly).
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const leave = db.leaveRequests.byId(id);
    if (!leave) throw new ApiError(404, "NOT_FOUND", "Leave request not found.");
    if (actor.role === "employee" && leave.employeeId !== actor.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "You can only cancel your own leave requests.");
    }
    if (actor.role === "employee") {
      if (leave.status === "pending") {
        // allowed
      } else if (leave.status === "approved" && leave.startDate >= todayIso()) {
        // allowed before start date
      } else {
        throw new ApiError(422, "RULE_VIOLATION", "Approved leave can only be cancelled before its start date.");
      }
    } else if (leave.status === "rejected" || leave.status === "cancelled") {
      throw new ApiError(422, "RULE_VIOLATION", "This request is already closed.");
    }

    const before = leave.status;
    const after = db.leaveRequests.update(id, { status: "cancelled", updatedAt: new Date().toISOString() });
    await db.leaveRequests.flush();
    await audit(actor, "cancel", "leave_request", id, { status: before }, { status: "cancelled" });

    if (actor.role !== "employee") {
      const e = db.employees.byId(leave.employeeId);
      if (e) await notify(e.userId, "leave_cancelled", "Leave cancelled", `Your leave from ${leave.startDate} to ${leave.endDate} was cancelled by HR.`, id);
    } else {
      const hrs = db.users.all().filter((u) => u.role === "hr" && u.isActive);
      for (const hr of hrs) {
        await notify(hr.id, "leave_cancelled", "Leave cancelled", `A leave request (${leave.startDate} to ${leave.endDate}) was cancelled by the employee.`, id);
      }
    }
    return ok(after);
  } catch (e) {
    return fail(e);
  }
}
