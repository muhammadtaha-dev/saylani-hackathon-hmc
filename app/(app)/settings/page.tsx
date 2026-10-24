"use client";

// Admin settings: company rules (hours, grace, half-day, weekend, office
// location & radius) + departments, designations, leave types, holidays.
import React, { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError } from "@/lib/client";
import { Badge, Button, Card, CardHeader, ConfirmDialog, Empty, ErrorState, Input, Loading, PageHeader, Select, Table, Tabs } from "@/lib/ui";

interface Settings { officeStart: string; graceMinutes: number; halfDayHours: number; weekend: number[]; officeLat: number | null; officeLng: number | null; radiusMeters: number; effectiveFrom: string }
interface Dept { id: string; name: string; isActive: boolean }
interface Desig { id: string; title: string; departmentId: string | null; isActive: boolean }
interface LeaveType { id: string; key: string; name: string; quota: number | null; isPaid: boolean; isActive: boolean }
interface Holiday { id: string; date: string; name: string }

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function SettingsPage() {
  const [tab, setTab] = useState("office");
  const [s, setS] = useState<Settings | null>(null);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [desigs, setDesigs] = useState<Desig[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newDept, setNewDept] = useState("");
  const [newDesig, setNewDesig] = useState("");
  const [newDesigDept, setNewDesigDept] = useState("");
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "" });
  const [deactivate, setDeactivate] = useState<{ kind: string; id: string; name: string; active: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [st, d] = await Promise.all([
        api.get<{ settings: Settings }>("/api/settings"),
        api.get<{ departments: Dept[]; designations: Desig[] }>("/api/departments"),
      ]);
      setS(st.settings);
      setDepts(d.departments);
      setDesigs(d.designations);
      const [lt, h] = await Promise.all([
        api.get<{ leaveTypes: LeaveType[] }>("/api/leave-types"),
        api.get<{ holidays: Holiday[] }>("/api/holidays"),
      ]);
      setTypes(lt.leaveTypes);
      setHolidays(h.holidays);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveOffice = async () => {
    if (!s) return;
    setBusy(true);
    try {
      await api.put("/api/settings", {
        officeStart: s.officeStart,
        graceMinutes: Number(s.graceMinutes),
        halfDayHours: Number(s.halfDayHours),
        weekend: s.weekend,
        officeLat: s.officeLat === null ? null : Number(s.officeLat),
        officeLng: s.officeLng === null ? null : Number(s.officeLng),
        radiusMeters: Number(s.radiusMeters),
      });
      toast.success("Settings saved — applies to new records only");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggleWeekend = (i: number) => {
    if (!s) return;
    setS({ ...s, weekend: s.weekend.includes(i) ? s.weekend.filter((x) => x !== i) : [...s.weekend, i].sort() });
  };

  const addDept = async () => {
    if (!newDept.trim()) return;
    try {
      await api.post("/api/departments", { name: newDept, type: "department" });
      setNewDept("");
      toast.success("Department added");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Failed.");
    }
  };
  const addDesig = async () => {
    if (!newDesig.trim()) return;
    try {
      await api.post("/api/departments", { title: newDesig, departmentId: newDesigDept || null, type: "designation" });
      setNewDesig("");
      setNewDesigDept("");
      toast.success("Designation added");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Failed.");
    }
  };
  const addHoliday = async () => {
    if (!newHoliday.date || !newHoliday.name.trim()) return;
    try {
      await api.post("/api/holidays", newHoliday);
      setNewHoliday({ date: "", name: "" });
      toast.success("Holiday added");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Failed.");
    }
  };
  const saveQuota = async (t: LeaveType, quota: string) => {
    try {
      await api.patch(`/api/leave-types?id=${t.id}`, { quota: quota === "" ? null : parseInt(quota, 10) });
      toast.success(`${t.name} quota updated`);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Failed.");
    }
  };

  const toggleActive = async () => {
    if (!deactivate) return;
    setBusy(true);
    try {
      if (deactivate.kind === "department") await api.patch(`/api/departments?id=${deactivate.id}&type=department`, { isActive: !deactivate.active });
      if (deactivate.kind === "designation") await api.patch(`/api/departments?id=${deactivate.id}&type=designation`, { isActive: !deactivate.active });
      if (deactivate.kind === "leave_type") await api.patch(`/api/leave-types?id=${deactivate.id}`, { isActive: !deactivate.active });
      toast.success(deactivate.active ? "Deactivated (soft) — history preserved" : "Activated");
      setDeactivate(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Failed.");
    } finally {
      setBusy(false);
    }
  };

  const removeHoliday = async (h: Holiday) => {
    try {
      await api.del(`/api/holidays?id=${h.id}`);
      toast.success("Holiday removed");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Failed.");
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Rules are data: they apply to new records only. Past records keep the rules they were judged by." />
      <Tabs
        tabs={[
          { key: "office", label: "Office rules" },
          { key: "org", label: "Departments & designations" },
          { key: "leave", label: "Leave types" },
          { key: "holidays", label: "Holidays" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "office" && s && (
        <Card>
          <CardHeader title="Company rules" subtitle={`Version effective from ${s.effectiveFrom}`} />
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Office start (HH:MM)" type="time" value={s.officeStart} onChange={(e) => setS({ ...s, officeStart: e.target.value })} />
            <Input label="Grace minutes (0–60)" type="number" min={0} max={60} value={s.graceMinutes} onChange={(e) => setS({ ...s, graceMinutes: Number(e.target.value) })} />
            <Input label="Half-day threshold hours (1–12)" type="number" min={1} max={12} value={s.halfDayHours} onChange={(e) => setS({ ...s, halfDayHours: Number(e.target.value) })} />
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">Weekend days</span>
              <div className="flex flex-wrap gap-1">
                {WD.map((d, i) => (
                  <button
                    key={d}
                    onClick={() => toggleWeekend(i)}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium ${s.weekend.includes(i) ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600"}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <Input label="Office latitude (optional)" type="number" step="any" value={s.officeLat ?? ""} onChange={(e) => setS({ ...s, officeLat: e.target.value === "" ? null : Number(e.target.value) })} />
            <Input label="Office longitude (optional)" type="number" step="any" value={s.officeLng ?? ""} onChange={(e) => setS({ ...s, officeLng: e.target.value === "" ? null : Number(e.target.value) })} />
            <Input label="Geofence radius meters (10–5000)" type="number" min={10} max={5000} value={s.radiusMeters} onChange={(e) => setS({ ...s, radiusMeters: Number(e.target.value) })} />
          </div>
          <div className="flex justify-end border-t border-slate-100 px-5 py-3">
            <Button onClick={saveOffice} loading={busy}>Save rules</Button>
          </div>
        </Card>
      )}

      {tab === "org" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Departments" />
            <div className="flex gap-2 px-5 py-3">
              <Input placeholder="New department name" value={newDept} onChange={(e) => setNewDept(e.target.value)} />
              <Button onClick={addDept} small><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {depts.length === 0 ? <Empty title="No departments" /> : (
              <div className="divide-y divide-slate-100">
                {depts.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-5 py-2 text-sm">
                    <span className="text-slate-700">{d.name}</span>
                    <div className="flex items-center gap-2">
                      <Badge value={d.isActive ? "active" : "inactive"}>{d.isActive ? "active" : "inactive"}</Badge>
                      <Button variant="ghost" small onClick={() => setDeactivate({ kind: "department", id: d.id, name: d.name, active: d.isActive })}>
                        {d.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Designations" />
            <div className="flex gap-2 px-5 py-3">
              <Input placeholder="New designation title" value={newDesig} onChange={(e) => setNewDesig(e.target.value)} />
              <Select value={newDesigDept} onChange={(e) => setNewDesigDept(e.target.value)} className="!w-40">
                <option value="">No dept</option>
                {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Button onClick={addDesig} small><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
            {desigs.length === 0 ? <Empty title="No designations" /> : (
              <div className="divide-y divide-slate-100">
                {desigs.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-5 py-2 text-sm">
                    <span className="text-slate-700">{d.title} <span className="text-xs text-slate-400">{depts.find((x) => x.id === d.departmentId)?.name ?? ""}</span></span>
                    <div className="flex items-center gap-2">
                      <Badge value={d.isActive ? "active" : "inactive"}>{d.isActive ? "active" : "inactive"}</Badge>
                      <Button variant="ghost" small onClick={() => setDeactivate({ kind: "designation", id: d.id, name: d.title, active: d.isActive })}>
                        {d.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "leave" && (
        <Card>
          <CardHeader title="Leave types & quotas" subtitle="Defaults were seeded at setup: Annual 14, Sick 8, Casual 10, Unpaid unlimited. Quotas are editable." />
          {types.length === 0 ? <Empty title="No leave types" /> : (
            <Table head={["Name", "Key", "Paid", "Quota (days/yr)", "Status", ""]}>
              {types.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5 font-medium text-slate-800">{t.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{t.key}</td>
                  <td className="px-4 py-2.5">{t.isPaid ? "paid" : <span className="text-red-500">unpaid</span>}</td>
                  <td className="px-4 py-2.5">
                    <input
                      type="number" min={0} max={365} defaultValue={t.quota ?? ""} placeholder="unlimited"
                      onBlur={(e) => String(t.quota ?? "") !== e.target.value && saveQuota(t, e.target.value)}
                      className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </td>
                  <td className="px-4 py-2.5"><Badge value={t.isActive ? "active" : "inactive"}>{t.isActive ? "active" : "inactive"}</Badge></td>
                  <td className="px-4 py-2.5 text-right">
                    <Button variant="ghost" small onClick={() => setDeactivate({ kind: "leave_type", id: t.id, name: t.name, active: t.isActive })}>
                      {t.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {tab === "holidays" && (
        <Card>
          <CardHeader title="Public holidays" subtitle="Excluded from leave working-day counts and attendance" />
          <div className="flex flex-wrap gap-2 px-5 py-3">
            <Input type="date" value={newHoliday.date} onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })} className="!w-40" />
            <Input placeholder="Holiday name" value={newHoliday.name} onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })} className="!w-56" />
            <Button onClick={addHoliday} small><Plus className="h-3.5 w-3.5" /> Add</Button>
          </div>
          {holidays.length === 0 ? <Empty title="No holidays configured" hint="Add the public holidays your company observes." /> : (
            <div className="divide-y divide-slate-100">
              {holidays.map((h) => (
                <div key={h.id} className="flex items-center justify-between px-5 py-2 text-sm">
                  <span className="text-slate-700">{h.date} · {h.name}</span>
                  <Button variant="ghost" small onClick={() => removeHoliday(h)}>Remove</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={!!deactivate}
        onClose={() => setDeactivate(null)}
        onConfirm={toggleActive}
        title={deactivate?.active ? `Deactivate ${deactivate.name}?` : `Activate ${deactivate?.name ?? ""}?`}
        message="Deactivation is soft: existing history stays valid for payroll and audit. It only stops new usage."
        confirmLabel={deactivate?.active ? "Deactivate" : "Activate"}
        danger={deactivate?.active}
        loading={busy}
      />
    </div>
  );
}
