import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/auth";
import { runChat, logAi, aiEnabled } from "@/lib/services/ai";

const schema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(4000) }))
    .max(20)
    .optional(),
});

// POST /api/ai/chat — all roles; scoped tools; guardrails enforced.
export async function POST(req: Request) {
  const started = Date.now();
  let actor: Awaited<ReturnType<typeof requireActor>> | null = null;
  let prompt = "";
  try {
    actor = requireActor(req);
    if (!rateLimit(`ai:${actor.userId}`, 20, 3600_000)) {
      await logAi({ actor, feature: "chat", prompt: "rate-limited", toolCalls: [], status: "rate_limited", latencyMs: Date.now() - started });
      throw new ApiError(429, "AI_RATE_LIMITED", "You've reached the AI limit of 20 requests per hour. Please try again later.");
    }
    const body = parseBody(schema, await readJson(req));
    prompt = body.message;
    if (!aiEnabled()) {
      await logAi({ actor, feature: "chat", prompt, toolCalls: [], status: "unconfigured", latencyMs: Date.now() - started });
      throw new ApiError(503, "AI_UNAVAILABLE", "AI assistant is not configured on this server. Add GEMINI_API_KEY to enable it.");
    }
    const result = await runChat(actor, body.message, body.history || []);
    await logAi({ actor, feature: "chat", prompt, toolCalls: result.toolsUsed, status: "ok", latencyMs: Date.now() - started });
    return ok(result);
  } catch (e) {
    if (actor) {
      const err = e as { code?: string; status?: number };
      const status = err.status ?? 500;
      // Timeout / provider errors get logged too.
      await logAi({ actor, feature: "chat", prompt: prompt || "unknown", toolCalls: [], status: status >= 500 ? "error" : err.code || "error", latencyMs: Date.now() - started }).catch(() => {});
    }
    if (e instanceof ApiError && e.code === "AI_UNAVAILABLE") {
      return ok({ answer: "The AI assistant is not configured on this server. You can still use the normal forms — nothing depends on AI.", toolsUsed: [], label: "AI-generated", fallback: true });
    }
    return fail(e);
  }
}
