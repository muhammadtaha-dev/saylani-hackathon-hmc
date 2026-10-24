"use client";

// My profile: employees may edit only phone + address (server-enforced).
import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api, ApiClientError } from "@/lib/client";
import { Badge, Button, Card, CardHeader, ErrorState, Input, Loading, PageHeader } from "@/lib/ui";
import { useSession } from "@/lib/session";

interface Row {
  id: string; code: string; firstName: string; lastName: string; email: string;
  phone: string | null; gender: string | null; joinDate: string; status: string;
  departmentName: string | null; designationTitle: string | null;
}

export default function ProfilePage() {
  const { user } = useSession();
  const [row, setRow] = useState<Row | null>(null);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: Row[] }>("/api/employees?limit=1");
      const me = res.data?.[0] ?? null;
      setRow(me);
      setPhone(me?.phone ?? "");
      if (me) {
        const r360 = await api.get<{ profile: { address: string | null } }>(`/api/employees/360?id=${me.id}`);
        setAddress(r360.profile.address ?? "");
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!row) return;
    setBusy(true);
    try {
      await api.patch(`/api/employees?id=${row.id}`, { phone: phone || null, address: address || null });
      toast.success("Profile updated");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!row) return <ErrorState message="No employee record is linked to your account." />;

  return (
    <div>
      <PageHeader title="My profile" subtitle="You can update your phone and address. Everything else is managed by HR." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Personal details" />
          <div className="space-y-2 px-5 py-4 text-sm">
            {[
              ["Name", `${row.firstName} ${row.lastName}`],
              ["Employee code", row.code],
              ["Email", row.email],
              ["Department", row.departmentName ?? "—"],
              ["Designation", row.designationTitle ?? "—"],
              ["Joined", row.joinDate],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-slate-50 pb-1.5">
                <span className="text-slate-500">{k}</span>
                <span className="font-medium text-slate-800">{v}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1">
              <span className="text-slate-500">Status</span>
              <Badge value={row.status} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Editable fields" subtitle="Phone and address only" />
          <div className="space-y-3 px-5 py-4">
            <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+92 300 1234567" />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Address</span>
              <textarea
                rows={3}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                placeholder="House 12, Street 4, Karachi"
              />
            </label>
            <div className="flex justify-end">
              <Button onClick={save} loading={busy}>Save changes</Button>
            </div>
          </div>
        </Card>
      </div>
      {user?.role === "employee" && <span className="hidden" />}
    </div>
  );
}
