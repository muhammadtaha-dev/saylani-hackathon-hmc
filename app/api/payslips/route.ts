import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";

// GET /api/payslips?month=&year= — own for Employee (finalized runs only),
// all for HR/Admin.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    let rows = db.payslips.all();
    if (actor.role === "employee") {
      rows = rows.filter((p) => p.employeeId === actor.employeeId);
      // Only finalized runs produce visible employee payslips (Ruling 5).
      rows = rows.filter((p) => db.payrollRuns.byId(p.runId)?.status === "finalized");
    }
    const month = url.searchParams.get("month");
    const year = url.searchParams.get("year");
    if (month) rows = rows.filter((p) => p.month === parseInt(month, 10));
    if (year) rows = rows.filter((p) => p.year === parseInt(year, 10));
    rows = rows.sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
    const data = rows.map((p) => {
      const e = db.employees.byId(p.employeeId);
      const run = db.payrollRuns.byId(p.runId);
      return {
        id: p.id,
        month: p.month,
        year: p.year,
        employeeId: p.employeeId,
        employeeName: e ? `${e.firstName} ${e.lastName}` : "Unknown",
        employeeCode: e?.code ?? null,
        status: run?.status ?? "draft",
        gross: p.gross,
        deductions: p.deductions,
        tax: p.tax,
        net: p.net,
      };
    });
    return ok({ payslips: data });
  } catch (e) {
    return fail(e);
  }
}

// GET single payslip detail via ?id= for the printable view.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    const body = (await req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) throw new ApiError(400, "VALIDATION", "id is required.");
    const p = db.payslips.byId(body.id);
    if (!p) throw new ApiError(404, "NOT_FOUND", "Payslip not found.");
    if (actor.role === "employee") {
      if (p.employeeId !== actor.employeeId) throw new ApiError(403, "FORBIDDEN", "You can only view your own payslips.");
      if (db.payrollRuns.byId(p.runId)?.status !== "finalized") throw new ApiError(403, "FORBIDDEN", "Payslip is not available yet.");
    }
    const e = db.employees.byId(p.employeeId);
    const dept = e?.departmentId ? db.departments.byId(e.departmentId) : null;
    const desig = e?.designationId ? db.designations.byId(e.designationId) : null;
    const run = db.payrollRuns.byId(p.runId);
    return ok({
      payslip: p,
      employee: e
        ? {
            name: `${e.firstName} ${e.lastName}`,
            code: e.code,
            designation: desig?.title ?? null,
            joinDate: e.joinDate,
          }
        : null,
      department: dept?.name ?? null,
      company: db.company.get(),
      run: run ? { status: run.status, finalizedAt: run.finalizedAt } : null,
    });
  } catch (e) {
    return fail(e);
  }
}
