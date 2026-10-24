import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/auth";
import { aiKey, logAi, aiEnabled } from "@/lib/services/ai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const schema = z.object({
  dashboard: z.enum(["admin", "hr"]),
  filters: z.record(z.string(), z.unknown()).optional(),
  kpis: z.record(z.string(), z.unknown()),
});

// Extract all numeric tokens from text.
function numbersIn(text: string): string[] {
  return text.match(/\d[\d,\.]*/g) || [];
}

function kpiNumberSet(kpis: Record<string, unknown>): Set<string> {
  const set = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "number") {
      set.add(String(v));
      set.add(v.toLocaleString("en-US"));
      set.add(v.toFixed(1));
      set.add(v.toFixed(2));
    } else if (typeof v === "string" && v !== "") set.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(kpis);
  return set;
}

// POST /api/ai/dashboard-summary — Admin/HR. 3-5 bullets referencing ONLY the
// supplied KPI numbers; post-generation number check with one retry.
export async function POST(req: Request) {
  const started = Date.now();
  let actor: Awaited<ReturnType<typeof requireActor>> | null = null;
  let kpis: Record<string, unknown> = {};
  try {
    actor = requireActor(req, { roles: ["admin", "hr"] });
    if (!rateLimit(`ai:${actor.userId}`, 20, 3600_000)) {
      throw new ApiError(429, "AI_RATE_LIMITED", "You've reached the AI limit of 20 requests per hour. Please try again later.");
    }
    const body = parseBody(schema, await readJson(req));
    kpis = body.kpis;
    if (!aiEnabled()) {
      await logAi({ actor, feature: "dashboard_summary", prompt: "unconfigured", toolCalls: [], status: "unconfigured", latencyMs: Date.now() - started });
      return ok({
        bullets: ["Not enough data yet."],
        label: "AI-generated",
        fallback: true,
        note: "AI is not configured on this server; showing no summary instead of inventing one.",
      });
    }
    if (!kpis || Object.keys(kpis).length === 0) {
      return ok({ bullets: ["Not enough data yet."], label: "AI-generated", fallback: true });
    }

    const gen = new GoogleGenerativeAI(aiKey() as string);
    const model = gen.getGenerativeModel({
      model: process.env.AI_MODEL || "gemini-1.5-flash",
      generationConfig: { temperature: 0.2, maxOutputTokens: 512 },
    });
    const instruction = [
      "You are summarizing an HR dashboard. Write 3 to 5 short bullets, one line each, starting with '- '.",
      "Use ONLY the numbers present in the JSON below. Never invent or round numbers that are not in the JSON.",
      "If a number is null or the data is empty, say there is not enough data yet.",
      "JSON: " + JSON.stringify({ dashboard: body.dashboard, filters: body.filters ?? {}, kpis }),
    ].join("\n");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let text = "";
    try {
      const res = await model.generateContent(instruction, { signal: ctrl.signal });
      text = res.response.text() || "";
    } finally {
      clearTimeout(timer);
    }

    // Post-generation number check: every number must exist in the KPI set.
    const allowed = kpiNumberSet(kpis);
    const extractBullets = (t: string) =>
      t
        .split("\n")
        .map((l) => l.replace(/^[-*•\d.\s]+/, "").trim())
        .filter((l) => l.length > 0)
        .slice(0, 5);

    let bullets = extractBullets(text);
    const clean = (bs: string[]) =>
      bs.filter((b) => {
        const nums = numbersIn(b);
        return nums.every((n) => allowed.has(n.replace(/,/g, "")) || allowed.has(n) || allowed.has(n.replace(/,/g, "")));
      });
    if (numbersIn(text).some((n) => !allowed.has(n.replace(/,/g, "")) && !allowed.has(n))) {
      // Retry once with a stricter instruction.
      const res2 = await model.generateContent(instruction + "\nSTRICT: your previous draft used numbers not in the JSON. Rewrite using only JSON numbers.");
      bullets = clean(extractBullets(res2.response.text() || ""));
    } else {
      bullets = clean(bullets);
    }
    if (bullets.length === 0) bullets = ["Not enough data yet."];
    await logAi({ actor, feature: "dashboard_summary", prompt: JSON.stringify(kpis).slice(0, 2000), toolCalls: [], status: "ok", latencyMs: Date.now() - started });
    return ok({ bullets, label: "AI-generated" });
  } catch (e) {
    if (actor) {
      await logAi({ actor, feature: "dashboard_summary", prompt: JSON.stringify(kpis).slice(0, 500), toolCalls: [], status: "error", latencyMs: Date.now() - started }).catch(() => {});
    }
    if (e instanceof ApiError) return fail(e);
    // Provider failure -> friendly fallback, never a crash.
    return ok({ bullets: ["Could not generate a summary right now. Please try again later."], label: "AI-generated", fallback: true });
  }
}
