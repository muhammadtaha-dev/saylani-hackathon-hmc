import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createDraftRun } from "@/lib/services/payroll";

// GET /api/payroll/runs — HR/Admin list runs (newest first)
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin", "hr"] });
    const rows = [...db.payrollRuns.all()].sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month));
    return ok({ runs: rows });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
});

// POST /api/payroll/runs — HR creates/regenerates a draft for the month.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    const body = parseBody(createSchema, await readJson(req));
    const before = db.payrollRuns.byMonthYear(body.month, body.year);
    const run = await createDraftRun({ userId: actor.userId }, body.year, body.month);
    await audit(actor, before ? "regenerate" : "create", "payroll_run", run.id, before ?? null, run);
    return ok(run, 201);
  } catch (e) {
    return fail(e);
  }
}
