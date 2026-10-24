import { Suspense } from "react";
import type React from "react";
import AppShell from "@/components/AppShell";
import { SessionProvider } from "@/lib/session";

// The whole (app) segment is auth-gated client-side: it cannot render an
// instant shell, so opt out of instant-navigation validation.
export const instant = false;

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Suspense fallback={<div className="flex min-h-screen items-center justify-center p-10 text-sm text-slate-400">Loading workspace…</div>}>
        <AppShell>{children}</AppShell>
      </Suspense>
    </SessionProvider>
  );
}
