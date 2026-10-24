import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";

// PUT /api/salary?employeeId=... — HR sets salary structure; derived HRA 40%,
// medical 10%, gross 1.5x; history kept with effectiveFrom (FR-M6-01).
const schema = z.object({
  basic: z.number().positive("Basic salary must be greater than 0."),
});

export async function PUT(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const employeeId = url.searchParams.get("employeeId");
    if (!employeeId) throw new ApiError(400, "VALIDATION", "employeeId query param is required.");
    const employee = db.employees.byId(employeeId);
    if (!employee) throw new ApiError(404, "NOT_FOUND", "Employee not found.");
    const body = parseBody(schema, await readJson(req));
    const basic = Math.round(body.basic * 100);
    const before = db.salaryStructures.latestFor(employeeId) ?? null;
    const row = {
      id: newId(),
      employeeId,
      basic,
      hra: Math.round(basic * 0.4),
      medical: Math.round(basic * 0.1),
      gross: Math.round(basic * 1.5),
      effectiveFrom: nowIso().slice(0, 10),
      createdBy: actor.userId,
      createdAt: nowIso(),
    };
    await db.salaryStructures.insert(row);
    await audit(actor, "salary_change", "salary_structure", row.id, before, row);
    return ok({
      salary: { basic, hra: row.hra, medical: row.medical, gross: row.gross, effectiveFrom: row.effectiveFrom },
    }, 201);
  } catch (e) {
    return fail(e);
  }
}
