import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit } from "@/lib/audit";

// GET /api/holidays
export async function GET(req: Request) {
  try {
    requireActor(req);
    const rows = [...db.holidays.all()].sort((a, b) => a.date.localeCompare(b.date));
    return ok({ holidays: rows });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(2).max(120),
});

export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const body = parseBody(createSchema, await readJson(req));
    if (db.holidays.byDate(body.date)) {
      throw new ApiError(409, "CONFLICT", "A holiday already exists on that date.");
    }
    const row = { id: newId(), date: body.date, name: body.name, createdAt: nowIso() };
    await db.holidays.insert(row);
    await audit(actor, "create", "holiday", row.id, null, row);
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}

// DELETE /api/holidays?id=... — holidays are config rows (not business history);
// removal is audited.
export async function DELETE(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const before = db.holidays.all().find((h) => h.id === id);
    if (!before) throw new ApiError(404, "NOT_FOUND", "Holiday not found.");
    db.holidays.remove(id);
    await db.holidays.flush();
    await audit(actor, "delete", "holiday", id, before, null);
    return ok({ removed: true });
  } catch (e) {
    return fail(e);
  }
}
