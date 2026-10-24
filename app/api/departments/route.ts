import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";

// GET /api/departments — Admin & HR read all; employees may need names too
export async function GET(req: Request) {
  try {
    requireActor(req);
    const rows = db.departments.all();
    const designations = db.designations.all();
    return ok({ departments: rows, designations });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.literal("department"),
});

const designationSchema = z.object({
  title: z.string().trim().min(2).max(80),
  departmentId: z.string().nullable().optional(),
  type: z.literal("designation"),
});

// POST /api/departments — Admin manages
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const body = (await readJson(req)) as Record<string, unknown>;
    if (body.type === "designation") {
      const d = parseBody(designationSchema, body);
      const dup = db.designations.all().find((x) => x.title.toLowerCase() === d.title.toLowerCase());
      if (dup) throw new ApiError(409, "CONFLICT", "A designation with this title already exists.");
      const row = {
        id: newId(),
        title: d.title,
        departmentId: d.departmentId ?? null,
        isActive: true,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      await db.designations.insert(row);
      await audit(actor, "create", "designation", row.id, null, row);
      return ok(row, 201);
    }
    const dep = parseBody(createSchema, body);
    const dup = db.departments.all().find((x) => x.name.toLowerCase() === dep.name.toLowerCase());
    if (dup) throw new ApiError(409, "CONFLICT", "A department with this name already exists.");
    const row = { id: newId(), name: dep.name, isActive: true, createdAt: nowIso(), updatedAt: nowIso() };
    await db.departments.insert(row);
    await audit(actor, "create", "department", row.id, null, row);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/departments?id=... — activate/deactivate or rename (soft deactivation)
export async function PATCH(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const type = url.searchParams.get("type") || "department";
    const body = await readJson(req);
    const patch = z.object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() }).parse(body);

    if (type === "designation") {
      const before = db.designations.byId(id);
      if (!before) throw new ApiError(404, "NOT_FOUND", "Designation not found.");
      const after = db.designations.update(id, patch);
      await db.designations.flush();
      await audit(actor, "update", "designation", id, before, after);
      return ok(after);
    }
    const before = db.departments.byId(id);
    if (!before) throw new ApiError(404, "NOT_FOUND", "Department not found.");
    const after = db.departments.update(id, patch);
    await db.departments.flush();
    await audit(actor, "update", "department", id, before, after);
    return ok(after);
  } catch (e) {
    return fail(e);
  }
}
