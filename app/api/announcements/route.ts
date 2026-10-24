import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, paginate, paged } from "@/lib/api";
import { db, newId, nowIso } from "@/lib/db";
import { audit, notify } from "@/lib/audit";

// GET /api/announcements — all roles read.
export async function GET(req: Request) {
  try {
    requireActor(req);
    const url = new URL(req.url);
    const rows = db.announcements.all();
    const page = paginate(rows, url.searchParams.get("page"), url.searchParams.get("limit"));
    return paged({ data: page.data, page: page.page, limit: page.limit, total: page.total });
  } catch (e) {
    return fail(e);
  }
}

const schema = z.object({
  title: z.string().trim().min(3).max(140),
  body: z.string().trim().min(5).max(2000),
});

// POST /api/announcements — Admin/HR post; everyone (optionally) notified.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    const body = parseBody(schema, await readJson(req));
    const row = {
      id: newId(),
      title: body.title,
      body: body.body,
      postedBy: actor.userId,
      postedByName: actor.email,
      publishedAt: nowIso(),
    };
    await db.announcements.insert(row);
    await audit(actor, "create", "announcement", row.id, null, { title: row.title });

    const recipients = db.users.all().filter((u) => u.isActive && u.id !== actor.userId);
    for (const r of recipients) {
      await notify(r.id, "announcement", row.title, row.body.slice(0, 160), row.id);
    }
    return ok(row, 201);
  } catch (e) {
    return fail(e);
  }
}
