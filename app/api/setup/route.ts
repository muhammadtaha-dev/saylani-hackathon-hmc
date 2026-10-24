import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, parseBody, readJson, ApiError } from "@/lib/api";
import { performSetup } from "@/lib/services/setup";

// GET /api/setup/status -> { initialized }
export async function GET() {
  try {
    return ok({ initialized: db.company.get() !== null, companyName: db.company.get()?.name ?? null });
  } catch (e) {
    return fail(e);
  }
}

const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email(),
  adminPassword: z.string().min(8).max(128),
  officeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  graceMinutes: z.number().int().min(0).max(60).optional(),
  timezone: z.string().max(60).optional(),
});

// POST /api/setup — one time only; subsequent calls -> 409
export async function POST(req: Request) {
  try {
    const body = parseBody(setupSchema, await readJson(req));
    const result = await performSetup(body);
    return ok(result, 201);
  } catch (e) {
    return fail(e);
  }
}
