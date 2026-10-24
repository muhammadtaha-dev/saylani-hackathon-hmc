import { ok, fail, requireActor } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso } from "@/lib/dates";
import { headcount, attritionPercent, averageSalary, headcountByDepartment, genderSplit, tenureSplit, payrollCostByDepartment, payrollCostByMonth } from "@/lib/services/metrics";

// GET /api/dashboard/admin?from=&to= — company KPIs, dept charts, audit feed.
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    const today = todayIso();
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const from = url.searchParams.get("from") || yearStart;
    const to = url.searchParams.get("to") || today;

    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const currentRun = db.payrollRuns.byMonthYear(month, year);

    return ok({
      kpis: {
        headcount: headcount({ to }),
        attritionYtd: attritionPercent({ from, to }),
        payrollCostThisMonthPaisa: currentRun?.totals.net ?? 0,
        payrollStatus: currentRun?.status ?? "none",
        averageSalaryPaisa: averageSalary({}),
      },
      headcountByDepartment: headcountByDepartment(),
      payrollCostByDepartment: currentRun ? payrollCostByDepartment(month, year) : [],
      payrollCostByMonth: payrollCostByMonth(6),
      genderSplit: genderSplit(),
      tenureSplit: tenureSplit(),
      auditFeed: db.auditLogs.all().slice(0, 10),
    });
  } catch (e) {
    return fail(e);
  }
}
