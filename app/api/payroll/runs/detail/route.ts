import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";

// GET /api/payroll/runs/detail?id=... — lines + totals; HR review/regenerate, Admin view.
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const run = db.payrollRuns.byId(id);
    if (!run) throw new ApiError(404, "NOT_FOUND", "Payroll run not found.");
    const lines = db.payslips
      .forRun(id)
      .map((p) => {
        const e = db.employees.byId(p.employeeId);
        const dept = e?.departmentId ? db.departments.byId(e.departmentId) : null;
        return {
          ...p,
          employeeName: e ? `${e.firstName} ${e.lastName}` : "Unknown",
          employeeCode: e?.code ?? null,
          department: dept?.name ?? null,
        };
      })
      .sort((a, b) => (a.employeeCode || "").localeCompare(b.employeeCode || ""));
    return ok({ run, lines });
  } catch (e) {
    return fail(e);
  }
}
