import { fail, requireActor } from "@/lib/api";
import { db } from "@/lib/db";

// GET /api/employees/export?search=&departmentId=&status= — CSV (HR) respecting filters.
function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const departmentId = url.searchParams.get("departmentId") || "";
    const status = url.searchParams.get("status") || "";

    let rows = db.employees.all();
    if (search) {
      rows = rows.filter((e) => [e.code, e.firstName, e.lastName, e.email].join(" ").toLowerCase().includes(search));
    }
    if (departmentId) rows = rows.filter((e) => e.departmentId === departmentId);
    if (status) rows = rows.filter((e) => e.status === status);
    rows.sort((a, b) => a.code.localeCompare(b.code));

    const header = ["code", "firstName", "lastName", "email", "phone", "department", "designation", "joinDate", "gender", "basic"];
    const lines = [header.join(",")];
    for (const e of rows) {
      const dept = e.departmentId ? db.departments.byId(e.departmentId)?.name ?? "" : "";
      const desig = e.designationId ? db.designations.byId(e.designationId)?.title ?? "" : "";
      const basic = (db.salaryStructures.latestFor(e.id)?.basic ?? 0) / 100;
      lines.push(
        [e.code, e.firstName, e.lastName, e.email, e.phone ?? "", dept, desig, e.joinDate, e.gender ?? "", basic]
          .map(csvCell)
          .join(",")
      );
    }
    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="employees.csv"`,
      },
    });
  } catch (e) {
    return fail(e);
  }
}
