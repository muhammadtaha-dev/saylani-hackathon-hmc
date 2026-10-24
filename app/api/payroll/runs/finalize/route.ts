import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { audit, notify } from "@/lib/audit";
import { finalizeRun } from "@/lib/services/payroll";

// POST /api/payroll/runs/finalize?id=... — Admin only; freezes payslips,
// locks the run, notifies employees, audits. Any later mutation -> 409.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const before = db.payrollRuns.byId(id);
    if (!before) throw new ApiError(404, "NOT_FOUND", "Payroll run not found.");
    const run = await finalizeRun({ userId: actor.userId }, id);
    await audit(actor, "finalize", "payroll_run", id, before, run);

    // Notifications: payslip available
    for (const slip of db.payslips.forRun(id)) {
      const e = db.employees.byId(slip.employeeId);
      if (e) {
        await notify(e.userId, "payslip_available", "Payslip available", `Your payslip for ${run.year}-${String(run.month).padStart(2, "0")} is ready. Net: ${(slip.net / 100).toLocaleString("en-PK", { style: "currency", currency: "PKR" })}.`, slip.id);
      }
    }
    return ok(run);
  } catch (e) {
    return fail(e);
  }
}
