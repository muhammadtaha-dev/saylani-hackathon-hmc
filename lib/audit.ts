// Append-only audit service. Every create/update/approve/reject/finalize/
// deactivate/reset action appends an entry. No update or delete exists.
import { db, newId, nowIso } from "./db";
import type { Actor } from "./types";

export async function audit(
  actor: Actor | null,
  action: string,
  entity: string,
  entityId: string | null,
  before: unknown,
  after: unknown
): Promise<void> {
  await db.auditLogs.insert({
    id: newId(),
    at: nowIso(),
    actorId: actor?.userId ?? "system",
    actorRole: actor?.role ?? "admin",
    actorEmail: actor?.email ?? "system",
    action,
    entity,
    entityId,
    before: before ?? null,
    after: after ?? null,
  });
}

export async function notify(
  userId: string,
  type: string,
  title: string,
  body: string,
  entityRef?: string | null
): Promise<void> {
  await db.notifications.insert({
    id: newId(),
    userId,
    type,
    title,
    body,
    isRead: false,
    entityRef: entityRef ?? null,
    createdAt: nowIso(),
  });
}
