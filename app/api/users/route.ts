import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { makeUser, generateTempPassword, hashPassword } from "@/lib/auth";
import { audit, notify } from "@/lib/audit";

// GET /api/users — Admin lists logins
export async function GET(req: Request) {
  try {
    requireActor(req, { roles: ["admin"] });
    const rows = db.users
      .all()
      .map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        isActive: u.isActive,
        mustChangePassword: u.mustChangePassword,
        employeeId: u.employeeId,
        createdAt: u.createdAt,
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return ok({ users: rows });
  } catch (e) {
    return fail(e);
  }
}

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
});

// POST /api/users — Admin creates an HR login with temp password (shown once)
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const body = parseBody(createSchema, await readJson(req));
    if (db.users.byEmail(body.email)) {
      throw new ApiError(409, "CONFLICT", "A user with this email already exists.");
    }
    const tempPassword = generateTempPassword();
    const user = makeUser({
      email: body.email,
      password: tempPassword,
      role: "hr",
      name: body.name,
      mustChangePassword: true,
    });
    await db.users.insert(user);
    await audit(actor, "create", "user", user.id, null, { email: user.email, role: "hr" });
    return ok({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, tempPassword }, 201);
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/users?id=...&action=deactivate|activate|reset — Admin manages logins
export async function PATCH(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const action = url.searchParams.get("action");
    if (!id || !action) throw new ApiError(400, "VALIDATION", "id and action query params are required.");
    const before = db.users.byId(id);
    if (!before) throw new ApiError(404, "NOT_FOUND", "User not found.");
    if (before.id === actor.userId) throw new ApiError(422, "RULE_VIOLATION", "You cannot deactivate or reset your own login.");

    if (action === "deactivate" || action === "activate") {
      const after = db.users.update(id, { isActive: action === "activate" });
      await db.users.flush();
      await audit(actor, action === "deactivate" ? "deactivate" : "activate", "user", id, { isActive: before.isActive }, { isActive: after?.isActive });
      return ok({ id, isActive: after?.isActive });
    }
    if (action === "reset") {
      const tempPassword = generateTempPassword();
      db.users.update(id, {
        passwordHash: hashPassword(tempPassword),
        mustChangePassword: true,
      });
      await db.users.flush();
      await notify(id, "password_reset", "Password reset", "Your password was reset by an administrator. Sign in with the new temporary password and change it.");
      await audit(actor, "reset_password", "user", id, null, { email: before.email });
      return ok({ id, tempPassword });
    }
    throw new ApiError(400, "VALIDATION", "Unknown action. Use deactivate, activate or reset.");
  } catch (e) {
    return fail(e);
  }
}
