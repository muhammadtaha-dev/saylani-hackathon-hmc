"use client";

// Session context: current actor, role, company; client-side routing guards
// (the server re-checks everything on every API call — this is UX only).
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, saveToken, getToken } from "./client";

export interface SessionUser {
  id: string;
  email: string;
  role: "admin" | "hr" | "employee";
  name: string;
  isActive: boolean;
  mustChangePassword: boolean;
  employeeId: string | null;
}

interface SessionState {
  loading: boolean;
  user: SessionUser | null;
  company: string | null;
  employee: { id: string; code: string; name: string } | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  loading: true,
  user: null,
  company: null,
  employee: null,
  refresh: async () => {},
  logout: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ loading: boolean; user: SessionUser | null; company: string | null; employee: SessionState["employee"] }>({
    loading: true,
    user: null,
    company: null,
    employee: null,
  });
  const router = useRouter();

  const refresh = useCallback(async () => {
    // Yield first: state writes must not run synchronously inside effects.
    await Promise.resolve();
    try {
      const me = await api.get<{
        user: SessionUser | null;
        employee: { id: string; code: string; name: string } | null;
        company: string | null;
      }>("/api/auth/me");
      setState({ loading: false, user: me.user, company: me.company, employee: me.employee });
    } catch {
      saveToken(null);
      setState({ loading: false, user: null, company: null, employee: null });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } catch {
      /* ignore */
    }
    saveToken(null);
    setState({ loading: false, user: null, company: null, employee: null });
    router.push("/login");
  }, [router]);

  useEffect(() => {
    if (!getToken()) {
      // Cookie may still hold a valid session (e.g. after refresh).
      fetch("/api/auth/me", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (j?.data?.user) {
            setState({ loading: false, user: j.data.user, company: j.data.company, employee: j.data.employee });
          } else {
            setState({ loading: false, user: null, company: null, employee: null });
          }
        })
        .catch(() => setState({ loading: false, user: null, company: null, employee: null }));
    } else {
      refresh();
    }
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ ...state, refresh, logout }}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export const roleHome: Record<string, string> = {
  admin: "/dashboard",
  hr: "/dashboard",
  employee: "/dashboard",
};
