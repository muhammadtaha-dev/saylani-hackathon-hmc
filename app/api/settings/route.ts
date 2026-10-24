import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";

// GET /api/settings — Admin & HR read
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin", "hr"] });
    const settings = db.settings.latest();
    return ok({ settings, company: db.company.get() });
  } catch (e) {
    return fail(e);
  }
}

const schema = z.object({
  officeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  graceMinutes: z.number().int().min(0).max(60),
  halfDayHours: z.number().min(1).max(12),
  weekend: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  officeLat: z.number().min(-90).max(90).nullable().optional(),
  officeLng: z.number().min(-180).max(180).nullable().optional(),
  radiusMeters: z.number().int().min(10).max(5000),
});

// PUT /api/settings — Admin only; writes a new version (applies to new records)
export async function PUT(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const body = parseBody(schema, await readJson(req));
    const current = db.settings.latest();
    const version = {
      id: newId(),
      officeStart: body.officeStart,
      graceMinutes: body.graceMinutes,
      halfDayHours: body.halfDayHours,
      weekend: body.weekend,
      officeLat: body.officeLat ?? null,
      officeLng: body.officeLng ?? null,
      radiusMeters: body.radiusMeters,
      effectiveFrom: nowIso().slice(0, 10),
      createdBy: actor.userId,
      createdAt: nowIso(),
    };
    await db.settings.insert(version);
    await audit(actor, "update", "settings", version.id, current, version);
    return ok({ settings: version });
  } catch (e) {
    return fail(e);
  }
}
