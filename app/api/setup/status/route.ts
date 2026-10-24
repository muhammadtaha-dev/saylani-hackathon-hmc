import { connection } from "next/server";
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/api";

// GET /api/setup/status -> { initialized } (FR-M2-01).
// Reads live DB state, so the handler must never be prerendered: connection()
// opts this GET route out of build-time static generation.
export async function GET() {
  // Keep connection() outside try/catch: during build-time prerender probing
  // it rejects intentionally, and that rejection must reach the framework.
  await connection();
  try {
    return ok({ initialized: db.company.get() !== null, companyName: db.company.get()?.name ?? null });
  } catch (e) {
    return fail(e);
  }
}
