import { z } from "zod";
import { db } from "@/lib/db";
import { ok, fail, parseBody, readJson, ApiError } from "@/lib/api";
import { verifyPassword, createSessionForUser, publicUser, rateLimit } from "@/lib/auth";
import { audit } from "@/lib/audit";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

export async function POST(req: Request) {
  try {
    const body = parseBody(loginSchema, await readJson(req));
    const ip = req.headers.get("x-forwarded-for") || "local";
    if (!rateLimit(`login:${ip}:${body.email}`, 10, 60_000)) {
      throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Please wait a minute and try again.");
    }
    const user = db.users.byEmail(body.email);
    const valid = user ? verifyPassword(body.password, user.passwordHash) : false;
    // Generic error — never reveal which part was wrong.
    if (!user || !valid || !user.isActive) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
    const token = await createSessionForUser(user);
    await audit({ userId: user.id, role: user.role, employeeId: user.employeeId, email: user.email, mustChangePassword: user.mustChangePassword }, "login", "user", user.id, null, null);
    return ok({ token, user: publicUser(user) });
  } catch (e) {
    return fail(e);
  }
}
