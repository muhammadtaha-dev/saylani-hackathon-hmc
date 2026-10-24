import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";

// GET /api/leave-types — everyone reads (needed for forms)
export async function GET(req: Request) {
  try {
    requireActor(req);
    return ok({ leaveTypes: db.leaveTypes.all().sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(60),
  quota: z.number().int().min(0).max(365).nullable(),
  isPaid: z.boolean().default(true),
});

export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const body = parseBody(createSchema, await readJson(req));
    const key = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom";
    const dup = db.leaveTypes.all().find((t) => t.name.toLowerCase() === body.name.toLowerCase());
    if (dup) throw new ApiError(409, "CONFLICT", "A leave type with this name already exists.");
    const row = {
      id: newId(),
      key: dup ? `${key}_2` : key,
      name: body.name,
      quota: body.quota,
      isPaid: body.isPaid,
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.leaveTypes.insert(row);
    await audit(actor, "create", "leave_type", row.id, null, row);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/leave-types?id=... — edit quota or deactivate (quota editable per FR-M2-03)
export async function PATCH(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const before = db.leaveTypes.byId(id);
    if (!before) throw new ApiError(404, "NOT_FOUND", "Leave type not found.");
    const patch = z
      .object({
        quota: z.number().int().min(0).max(365).nullable().optional(),
        isActive: z.boolean().optional(),
        name: z.string().trim().min(2).max(60).optional(),
        isPaid: z.boolean().optional(),
      })
      .parse(await readJson(req));
    const after = db.leaveTypes.update(id, patch);
    await db.leaveTypes.flush();
    await audit(actor, "update", "leave_type", id, before, after);
    return ok(after);
  } catch (e) {
    return fail(e);
  }
}
