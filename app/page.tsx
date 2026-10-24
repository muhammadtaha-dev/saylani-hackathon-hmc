"use client";

// Entry point: route to setup (fresh install), login, or the app.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { Loading } from "@/lib/ui";

export default function Home() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await api.get<{ initialized: boolean }>("/api/setup/status");
        if (!status.initialized) {
          router.replace("/setup");
          return;
        }
      } catch {
        setMsg("Server unreachable. Is it running?");
        return;
      }
      try {
        const me = await api.get<{ user: { role: string; mustChangePassword: boolean } | null }>("/api/auth/me");
        if (me.user) {
          router.replace(me.user.mustChangePassword ? "/change-password" : "/dashboard");
        } else {
          router.replace("/login");
        }
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  return <Loading label={msg ?? "Starting HCM Lite…"} />;
}
