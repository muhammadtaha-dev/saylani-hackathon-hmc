import { ok, fail, requireActor } from "@/lib/api";
import { leaveBalanceFor } from "@/lib/services/leave";

// GET /api/leave/balance — per type {quota, approved, pending, remaining} for the year.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const year = url.searchParams.get("year") || undefined;
    let employeeId = actor.employeeId;
    if (actor.role !== "employee" && url.searchParams.get("employeeId")) {
      employeeId = url.searchParams.get("employeeId");
    }
    return ok({ year: year || new Date().getFullYear().toString(), balances: leaveBalanceFor(employeeId || "", year) });
  } catch (e) {
    return fail(e);
  }
}
