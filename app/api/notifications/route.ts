import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";

// GET /api/notifications — own only.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const rows = db.notifications.forUser(actor.userId);
    return ok({ notifications: rows, unread: rows.filter((n) => !n.isRead).length });
  } catch (e) {
    return fail(e);
  }
}

// POST /api/notifications?id=...&action=read|read-all — own only.
export async function POST(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "read";
    if (action === "read-all") {
      await db.notifications.markAllRead(actor.userId);
      return ok({ read: "all" });
    }
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const n = db.notifications.forUser(actor.userId).find((x) => x.id === id);
    if (!n) throw new ApiError(404, "NOT_FOUND", "Notification not found.");
    db.notifications.update(id, { isRead: true });
    await db.notifications.flush();
    return ok({ read: id });
  } catch (e) {
    return fail(e);
  }
}
