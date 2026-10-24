"use client";

// Floating AI chat drawer: message list, suggested prompts per role,
// "AI-generated" label, retry on failure. Calls POST /api/ai/chat.
import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, SendHorizonal } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { AIBadge, Button, Spinner } from "@/lib/ui";
import { useSession } from "@/lib/session";

interface Msg {
  role: "user" | "model";
  text: string;
  label?: boolean;
}

const SUGGESTED: Record<string, string[]> = {
  admin: [
    "How many active employees do we have?",
    "Summarize this month's payroll.",
    "Who came late most often this month?",
  ],
  hr: [
    "Who came late most often this month?",
    "What is this month's attendance rate?",
    "Which department has the most absences?",
  ],
  employee: [
    "How many sick leaves do I have left?",
    "What is my attendance rate?",
    "Explain the leave policy.",
  ],
};

export default function AIChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useSession();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setInput("");
    const history = messages.filter((m) => !m.label).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await api.post<{ answer: string; toolsUsed: string[]; label: string; fallback?: boolean }>("/api/ai/chat", {
        message,
        history,
      });
      setMessages((m) => [...m, { role: "model", text: res.answer, label: true }]);
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "The assistant is unavailable right now. Please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-violet-100 p-1.5"><Sparkles className="h-4 w-4 text-violet-600" /></span>
            <div>
              <p className="text-sm font-semibold text-slate-900">AI Assistant</p>
              <p className="text-xs text-slate-400">Answers use your access rights only</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close AI panel">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Try one of these:</p>
              <div className="flex flex-wrap gap-2">
                {(SUGGESTED[user?.role ?? "employee"] ?? []).map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-slate-900 text-white" : "border border-slate-200 bg-slate-50 text-slate-800"
                }`}
              >
                {m.text}
                {m.label && <div className="mt-2"><AIBadge /></div>}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-slate-400"><Spinner /> Thinking…</div>
          )}
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
              <button onClick={() => { setError(null); }} className="ml-2 underline">dismiss</button>
            </div>
          )}
        </div>

        <form
          className="flex items-center gap-2 border-t border-slate-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={user?.role === "employee" ? "Ask about your own data or policy…" : "Ask about company data…"}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
          />
          <Button type="submit" loading={busy} disabled={!input.trim()}>
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
