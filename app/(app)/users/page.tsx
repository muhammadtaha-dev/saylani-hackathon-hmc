"use client";

// Admin: HR logins management (create with temp password shown once,
// deactivate/activate, reset password).
import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, UserPlus } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError } from "@/lib/client";
import { Badge, Button, Card, ConfirmDialog, Empty, ErrorState, Input, Loading, Modal, PageHeader, Table } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface UserRow {
  id: string; email: string; name: string; role: string; isActive: boolean;
  mustChangePassword: boolean; employeeId: string | null; createdAt: string;
}

export default function UsersPage() {
  const { user: me } = useSession();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<{ row: UserRow; action: "deactivate" | "activate" | "reset" } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ users: UserRow[] }>("/api/users");
      setRows(res.users);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ user: { email: string }; tempPassword: string }>("/api/users", form);
      setOpen(false);
      setForm({ name: "", email: "" });
      setTempPassword({ email: res.user.email, password: res.tempPassword });
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Creation failed.");
    } finally {
      setBusy(false);
    }
  };

  const act = async () => {
    const c = confirm;
    if (!c) return;
    setBusy(true);
    try {
      const res = await api.patch<{ tempPassword?: string }>(`/api/users?id=${c.row.id}&action=${c.action}`);
      if (c.action === "reset" && res.tempPassword) {
        setTempPassword({ email: c.row.email, password: res.tempPassword });
      } else {
        toast.success(c.action === "deactivate" ? "Login deactivated — token stops working at once" : "Login activated");
      }
      setConfirm(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  if (me?.role !== "admin") {
    return <Empty title="Admins only" hint="This screen manages HR logins." />;
  }

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Create HR logins, deactivate or reset passwords. Temporary passwords are shown exactly once."
        actions={<Button small onClick={() => setOpen(true)}><UserPlus className="h-3.5 w-3.5" /> Create HR login</Button>}
      />

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows || rows.length === 0 ? (
          <Empty title="No users" />
        ) : (
          <Table head={["Name", "Email", "Role", "Status", "Created", ""]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.name} {r.id === me.id && <span className="text-xs text-slate-400">(you)</span>}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.email}</td>
                <td className="px-4 py-2.5"><Badge value={r.role === "admin" ? "approved" : "pending"}>{r.role}</Badge></td>
                <td className="px-4 py-2.5">
                  <Badge value={r.isActive ? "active" : "inactive"}>{r.isActive ? "active" : "deactivated"}</Badge>
                  {r.mustChangePassword && <span className="ml-1 text-xs text-amber-500">temp password</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDateTime(r.createdAt)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    {r.id !== me.id && r.role === "hr" && (
                      <>
                        <Button variant="ghost" small onClick={() => setConfirm({ row: r, action: "reset" })}><KeyRound className="h-3.5 w-3.5" /> Reset</Button>
                        <Button variant="ghost" small onClick={() => setConfirm({ row: r, action: r.isActive ? "deactivate" : "activate" })}>
                          {r.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Create HR login">
        <div className="space-y-3">
          <Input label="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <p className="text-xs text-slate-400">A temporary password is generated and shown once. HR must change it at first sign-in.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} loading={busy} disabled={!form.name.trim() || !form.email.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!tempPassword} onClose={() => setTempPassword(null)} title="Temporary password">
        {tempPassword && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">Share with <strong>{tempPassword.email}</strong>. Shown <strong>only once</strong>:</p>
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-lg font-bold text-amber-700">
              <KeyRound className="h-5 w-5" /> {tempPassword.password}
            </div>
            <div className="flex justify-end"><Button onClick={() => setTempPassword(null)}>Done</Button></div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={act}
        title={confirm?.action === "reset" ? "Reset password" : confirm?.action === "deactivate" ? "Deactivate login" : "Activate login"}
        message={
          confirm?.action === "reset"
            ? `Generate a new temporary password for ${confirm!.row.email}? The current password stops working.`
            : confirm?.action === "deactivate"
            ? `Deactivate ${confirm!.row.email}? Their token stops working at once; history is preserved.`
            : `Reactivate ${confirm!.row.email}?`
        }
        confirmLabel={confirm?.action === "reset" ? "Reset password" : confirm?.action === "deactivate" ? "Deactivate" : "Activate"}
        danger={confirm?.action === "deactivate"}
        loading={busy}
      />
    </div>
  );
}
