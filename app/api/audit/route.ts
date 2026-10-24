import { fail, requireActor, paginate, paged } from "@/lib/api";
import { db } from "@/lib/db";

// GET /api/audit?actor=&action=&entity=&from=&to=&page= — Admin only.
// Entries are append-only; no update/delete endpoint exists anywhere.
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    let rows = db.auditLogs.all();
    const actor = url.searchParams.get("actor");
    const action = url.searchParams.get("action");
    const entity = url.searchParams.get("entity");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (actor) rows = rows.filter((r) => r.actorId === actor || r.actorEmail === actor);
    if (action) rows = rows.filter((r) => r.action === action);
    if (entity) rows = rows.filter((r) => r.entity === entity);
    if (from) rows = rows.filter((r) => r.at.slice(0, 10) >= from);
    if (to) rows = rows.filter((r) => r.at.slice(0, 10) <= to);
    const page = paginate(rows, url.searchParams.get("page"), url.searchParams.get("limit"));
    return paged({ data: page.data, page: page.page, limit: page.limit, total: page.total });
  } catch (e) {
    return fail(e);
  }
}
