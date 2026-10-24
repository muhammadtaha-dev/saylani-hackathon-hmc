"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError, saveToken } from "@/lib/client";
import { Button, Input, Loading } from "@/lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [company, setCompany] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ initialized: boolean; companyName: string | null }>("/api/setup/status")
      .then((s) => {
        setCompany(s.companyName);
        if (!s.initialized) router.replace("/setup");
        else setChecking(false);
      })
      .catch(() => {
        setChecking(false);
      });
  }, [router]);

  if (checking) return <Loading />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post<{ token: string; user: { role: string; mustChangePassword: boolean } }>("/api/auth/login", { email, password });
      saveToken(res.token);
      toast.success("Signed in");
      router.replace(res.user.mustChangePassword ? "/change-password" : "/dashboard");
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Sign-in failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 inline-flex rounded-2xl bg-slate-900 p-3">
            <Building2 className="h-6 w-6 text-white" />
          </span>
          <h1 className="text-xl font-bold text-slate-900">{company ?? "HCM Lite"}</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to continue</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Input
            label="Email"
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
          <Input
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
          <Button type="submit" loading={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
