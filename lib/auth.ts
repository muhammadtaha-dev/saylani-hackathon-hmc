// Auth: bcrypt password hashing (cost >= 10), hand-rolled HS256 JWT (8h expiry),
// cookie + Bearer token session, actor resolution with isActive checks.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db, nowIso, newId } from "./db";
import type { Actor, Role, User } from "./types";

export const COOKIE_NAME = "hcm_token";
const TOKEN_TTL_SECONDS = 8 * 3600;

function jwtSecret(): string {
  return process.env.JWT_SECRET || "hcm-lite-dev-secret-change-me";
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signToken(payload: { sub: string; role: Role; employeeId: string | null }): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })
  );
  const sig = crypto.createHmac("sha256", jwtSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): { sub: string; role: Role; employeeId: string | null } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac("sha256", jwtSecret()).update(`${header}.${body}`).digest("base64url");
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sub: payload.sub, role: payload.role, employeeId: payload.employeeId ?? null };
  } catch {
    return null;
  }
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string): boolean {
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

function tokenFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const cookieHeader = req.headers.get("cookie") || "";
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

// Resolve the caller. Returns null when unauthenticated or deactivated.
export function resolveActor(req: Request): Actor | null {
  const token = tokenFromRequest(req);
  if (!token) return null;
  const claims = verifyToken(token);
  if (!claims) return null;
  const user: User | undefined = db.users.byId(claims.sub);
  if (!user || !user.isActive) return null;
  return {
    userId: user.id,
    role: user.role,
    employeeId: user.employeeId,
    email: user.email,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function createSessionForUser(user: User): Promise<string> {
  const token = signToken({ sub: user.id, role: user.role, employeeId: user.employeeId });
  await setSessionCookie(token);
  return token;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    employeeId: user.employeeId,
  };
}

// Simple in-memory sliding-window rate limiter (per user or per ip).
const rateBuckets = new Map<string, number[]>();
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}

export function makeUser(params: {
  email: string;
  password: string;
  role: Role;
  name: string;
  employeeId?: string | null;
  mustChangePassword?: boolean;
}): User {
  return {
    id: newId(),
    email: params.email.trim().toLowerCase(),
    passwordHash: hashPassword(params.password),
    role: params.role,
    isActive: true,
    mustChangePassword: params.mustChangePassword ?? true,
    employeeId: params.employeeId ?? null,
    name: params.name,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}
