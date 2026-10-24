import { ok, fail, requireActor } from "@/lib/api";
import { runSelfTest } from "@/lib/selftest";

// GET /api/selftest — Admin-only rule-engine verification (T11/T12/T07 + precedence).
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin"] });
    return ok(runSelfTest());
  } catch (e) {
    return fail(e);
  }
}
