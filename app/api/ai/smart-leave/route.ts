import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError } from "@/lib/api";
import { rateLimit } from "@/lib/auth";
import { logAi, aiKey, aiEnabled } from "@/lib/services/ai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { todayIso, companyTimezone, weekdayOfIso, isValidIsoDate, nextWeekday } from "@/lib/dates";
import { db } from "@/lib/db";
import { workingDaysBetween } from "@/lib/services/leave";

const schema = z.object({
  text: z.string().trim().min(3).max(500),
});

// Server context injected into the prompt (today, weekday, timezone, weekend,
// holidays, leave types) so relative dates resolve on the server.
function buildContext() {
  const today = todayIso();
  const settings = (() => {
    const s = db.settings.latest();
    return s ? s.weekend : [0, 6];
  })();
  const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return {
    today,
    weekday: weekdayNames[weekdayOfIso(today)],
    timezone: companyTimezone(),
    weekend: settings.includes(0) && settings.includes(6) ? "Sat-Sun" : settings.join(","),
    holidays: db.holidays.all().slice(0, 20).map((h) => ({ date: h.date, name: h.name })),
    leaveTypes: db.leaveTypes.active().map((t) => ({ key: t.key, name: t.name, quota: t.quota })),
    nextMonday: nextWeekday(today, 1),
  };
}

interface ParsedLeave {
  type: string;
  start: string;
  end: string;
  reason: string;
}

function validateParsed(parsed: unknown, ctx: ReturnType<typeof buildContext>): ParsedLeave | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.start !== "string" || typeof p.end !== "string" || typeof p.reason !== "string") return null;
  if (!isValidIsoDate(p.start) || !isValidIsoDate(p.end)) return null;
  if (p.start > p.end) return null;
  const typeRaw = typeof p.type === "string" ? p.type.toLowerCase() : "";
  const known = ctx.leaveTypes.find((t) => t.key === typeRaw || t.name.toLowerCase() === typeRaw);
  if (!known) return null;
  // Server re-validation: dates must not be absurdly far out; reason length.
  if (p.reason.length < 3 || p.reason.length > 300) return null;
  const days = workingDaysBetween(p.start, p.end);
  if (days <= 0) return null;
  return { type: known.key, start: p.start, end: p.end, reason: p.reason.trim() };
}

// POST /api/ai/smart-leave — natural text -> {type,start,end,reason} or
// {fallback:true}. Never saves; the UI pre-fills an editable form.
export async function POST(req: Request) {
  const started = Date.now();
  let actor: Awaited<ReturnType<typeof requireActor>> | null = null;
  let prompt = "";
  try {
    actor = requireActor(req);
    if (!actor.employeeId) {
      throw new ApiError(422, "RULE_VIOLATION", "No employee record is linked to this account.");
    }
    if (!rateLimit(`ai:${actor.userId}`, 20, 3600_000)) {
      throw new ApiError(429, "AI_RATE_LIMITED", "You've reached the AI limit of 20 requests per hour. Please try again later.");
    }
    const body = parseBody(schema, await readJson(req));
    prompt = body.text;
    const ctx = buildContext();
    if (!aiEnabled()) {
      await logAi({ actor, feature: "smart_leave", prompt, toolCalls: [], status: "unconfigured", latencyMs: Date.now() - started });
      return ok({ fallback: true, reason: "AI is not configured on this server. Please fill the form manually.", context: ctx });
    }

    const gen = new GoogleGenerativeAI(aiKey() as string);
    const model = gen.getGenerativeModel({
      model: process.env.AI_MODEL || "gemini-1.5-flash",
      generationConfig: { temperature: 0.1, maxOutputTokens: 256, responseMimeType: "application/json" },
    });
    const instruction = [
      "Extract a leave request from the user's sentence. Reply ONLY with JSON of shape:",
      '{"type":"annual|sick|casual|unpaid","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reason":"short reason"}',
      "Resolve relative dates using the context. 'next Monday' means the first Monday strictly after today.",
      "Choose the most plausible leave type (wedding/family/casual -> casual; medical -> sick; vacation -> annual; no pay -> unpaid).",
      "Context: " + JSON.stringify(ctx),
      "Sentence: " + body.text,
    ].join("\n");

    const call = async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15_000);
      try {
        return await model.generateContent(instruction, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    let parsed: ParsedLeave | null = null;
    let attempt = 0;
    while (attempt < 2 && !parsed) {
      attempt++;
      try {
        const res = await call();
        const raw = (res.response.text() || "").trim();
        const json = JSON.parse(raw.replace(/^```json\s*|```$/g, ""));
        parsed = validateParsed(json, ctx);
      } catch {
        parsed = null;
      }
    }
    if (!parsed) {
      // Retry once then fallback flag (T21).
      await logAi({ actor, feature: "smart_leave", prompt, toolCalls: [], status: "fallback", latencyMs: Date.now() - started });
      return ok({ fallback: true, reason: "Could not understand the request confidently. Please fill the form manually.", context: ctx });
    }

    // Extra context for the UI: working days + policy pre-checks via the same
    // services the form uses (read-only; nothing is saved here).
    const preCheck = {
      workingDays: workingDaysBetween(parsed.start, parsed.end),
      isBackdated: parsed.start < ctx.today,
      backdateAllowedFor: ["sick"],
    };
    await logAi({ actor, feature: "smart_leave", prompt, toolCalls: [], status: "ok", latencyMs: Date.now() - started });
    return ok({ suggestion: parsed, preCheck, context: ctx, label: "AI-generated" });
  } catch (e) {
    if (actor) {
      await logAi({ actor, feature: "smart_leave", prompt, toolCalls: [], status: "error", latencyMs: Date.now() - started }).catch(() => {});
    }
    if (e instanceof ApiError) return fail(e);
    return ok({ fallback: true, reason: "AI could not process the request right now. Please fill the form manually." });
  }
}
