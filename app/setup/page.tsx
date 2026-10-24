"use client";

// Setup wizard — only reachable while the system is uninitialized.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError } from "@/lib/client";
import { Button, Input, Loading } from "@/lib/ui";

export default function SetupPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    companyName: "",
    adminName: "",
    adminEmail: "",
    adminPassword: "",
  });

  useEffect(() => {
    api
      .get<{ initialized: boolean }>("/api/setup/status")
      .then((s) => {
        if (s.initialized) router.replace("/login");
        else setChecking(false);
      })
      .catch(() => {
        setChecking(false);
        toast.error("Server unreachable.");
      });
  }, [router]);

  if (checking) return <Loading label="Checking installation…" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/setup", form);
      toast.success("Company created. Please sign in as the Admin.");
      router.replace("/login");
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Setup failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 inline-flex rounded-2xl bg-slate-900 p-3">
            <Building2 className="h-7 w-7 text-white" />
          </span>
          <h1 className="text-2xl font-bold text-slate-900">Welcome to HCM Lite</h1>
          <p className="mt-1 text-sm text-slate-500">First-run setup: create your company and the Admin account. This screen appears only once.</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Input
            label="Company name"
            required
            minLength={2}
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            placeholder="Acme Corporation"
          />
          <Input
            label="Admin name"
            required
            minLength={2}
            value={form.adminName}
            onChange={(e) => setForm({ ...form, adminName: e.target.value })}
            placeholder="Taha Ahmed"
          />
          <Input
            label="Admin email"
            type="email"
            required
            value={form.adminEmail}
            onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
            placeholder="admin@acme.com"
          />
          <Input
            label="Admin password (min 8 characters)"
            type="password"
            required
            minLength={8}
            value={form.adminPassword}
            onChange={(e) => setForm({ ...form, adminPassword: e.target.value })}
            placeholder="••••••••"
          />
          <p className="text-xs text-slate-400">
            Defaults applied: office 09:00, 15-minute grace, half day under 5h, weekend Sat–Sun. Default leave types (Annual 14, Sick 8, Casual 10, Unpaid unlimited) are seeded automatically.
          </p>
          <Button type="submit" loading={busy} className="w-full">
            Create company & Admin
          </Button>
        </form>
      </div>
    </div>
  );
}
