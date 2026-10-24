// Standard API envelope: success { data }, error { error: { code, message, details? } }.
// Every route handler declares its allowed roles here — least privilege, by default-deny.
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveActor } from "./auth";
import type { Actor, Role } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data }, { status });
}

export function fail(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status }
    );
  }
  // Prerender bail-outs (build-time probes hitting request data) are expected;
  // never log or convert them.
  const digest = (error as { digest?: string })?.digest;
  if (typeof digest === "string" && digest.startsWith("NEXT_PRERENDER")) {
    throw error;
  }
  console.error("[api] unexpected:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong. Please try again." } },
    { status: 500 }
  );
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join("."), reason: i.message }));
    throw new ApiError(400, "VALIDATION", "Invalid input.", details);
  }
  return result.data;
}

export function requireActor(req: Request, opts: { roles?: Role[]; allowPasswordPending?: boolean } = {}): Actor {
  const actor = resolveActor(req);
  if (!actor) throw new ApiError(401, "UNAUTHENTICATED", "Please sign in.");
  if (!opts.allowPasswordPending && actor.mustChangePassword) {
    throw new ApiError(403, "PASSWORD_CHANGE_REQUIRED", "Change your password before continuing.");
  }
  if (opts.roles && !opts.roles.includes(actor.role)) {
    throw new ApiError(403, "FORBIDDEN", "You do not have access to this action.");
  }
  return actor;
}

// Employees are always scoped to their own employeeId; client cannot widen it.
export function scopeEmployeeId(actor: Actor, requestedEmployeeId?: string | null): string {
  if (actor.role === "employee") {
    if (!actor.employeeId) throw new ApiError(403, "FORBIDDEN", "No employee record is linked to this account.");
    if (requestedEmployeeId && requestedEmployeeId !== actor.employeeId) {
      throw new ApiError(403, "FORBIDDEN", "You can only access your own records.");
    }
    return actor.employeeId;
  }
  if (requestedEmployeeId) return requestedEmployeeId;
  throw new ApiError(400, "VALIDATION", "employeeId is required.");
}

export function paginate<T>(list: T[], pageQ: string | null, limitQ: string | null) {
  const page = Math.max(1, parseInt(pageQ || "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitQ || "20", 10) || 20));
  const start = (page - 1) * limit;
  return {
    data: list.slice(start, start + limit),
    page,
    limit,
    total: list.length,
  };
}

export function paged(list: { data: unknown[]; page: number; limit: number; total: number }) {
  return NextResponse.json(
    { data: list.data, page: list.page, limit: list.limit, total: list.total },
    { status: 200 }
  );
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "VALIDATION", "Request body must be valid JSON.");
  }
}
