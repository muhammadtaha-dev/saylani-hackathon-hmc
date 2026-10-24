import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword, clearSessionCookie } from "@/lib/auth";
import { audit } from "@/lib/audit";

const schema = z.object({
  current: z.string().min(1).max(128),
  new: z.string().min(8, "New password must be at least 8 characters.").max(128),
});

export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { allowPasswordPending: true });
    const body = parseBody(schema, await readJson(req));
    const user = db.users.byId(actor.userId);
    if (!user) throw new ApiError(404, "NOT_FOUND", "User not found.");
    if (!verifyPassword(body.current, user.passwordHash)) {
      throw new ApiError(422, "RULE_VIOLATION", "Current password is incorrect.");
    }
    if (body.current === body.new) {
      throw new ApiError(422, "RULE_VIOLATION", "New password must differ from the current password.");
    }
    db.users.update(user.id, { passwordHash: hashPassword(body.new), mustChangePassword: false });
    await db.users.flush();
    await audit(actor, "password_change", "user", user.id, null, null);
    await clearSessionCookie();
    return ok({ changed: true });
  } catch (e) {
    return fail(e);
  }
}
