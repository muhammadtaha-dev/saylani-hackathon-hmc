"use client";

// Forced password change screen (mustChangePassword gate).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError, saveToken } from "@/lib/client";
import { Button, Input, Loading } from "@/lib/ui";
import { useSession } from "@/lib/session";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { loading, user, refresh } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (!user) {
    router.replace("/login");
    return <Loading />;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      toast.error("New passwords do not match.");
      return;
    }
    if (next.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/api/auth/change-password", { current, new: next });
      saveToken(null);
      toast.success("Password changed. Please sign in with your new password.");
      await refresh();
      router.replace("/login");
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Password change failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <span className="mx-auto mb-3 inline-flex rounded-2xl bg-amber-100 p-3">
            <KeyRound className="h-6 w-6 text-amber-600" />
          </span>
          <h1 className="text-xl font-bold text-slate-900">Change your password</h1>
          <p className="mt-1 text-sm text-slate-500">
            You are signed in with a temporary password. Choose a new one (min 8 characters) to continue.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Input label="Current (temporary) password" type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <Input label="New password" type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
          <Input label="Confirm new password" type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <Button type="submit" loading={busy} className="w-full">
            Save new password
          </Button>
        </form>
      </div>
    </div>
  );
}
