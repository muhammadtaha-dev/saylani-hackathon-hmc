"use client";

// Role-based dashboards. All numbers come from the metrics service via
// /api/dashboard/{hr|admin|me}; the Summarize button sends the exact same KPI
// JSON to the AI (numbers stay identical to the dashboard).
import React, { useCallback, useEffect, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from "recharts";
import { LogIn, LogOut, Sparkles, Clock, CalendarDays, Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError } from "@/lib/client";
import { Badge, Button, Card, CardHeader, Empty, ErrorState, KPI, Loading, AIBadge } from "@/lib/ui";
import { fmtPKR, fmtPKRShort, fmtTime, fmtMinutes, monthName, pct } from "@/lib/format";
import { useSession } from "@/lib/session";

const CHART_COLORS = ["#0f172a", "#475569", "#94a3b8", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9"];

// ---------- Summarize (Admin/HR) ----------

export function Summarize({ dashboard, kpis }: { dashboard: "admin" | "hr"; kpis: Record<string, unknown> }) {
  const [bullets, setBullets] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const summarize = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ bullets: string[]; label: string; fallback?: boolean }>("/api/ai/dashboard-summary", {
        dashboard,
        filters: {},
        kpis,
      });
      setBullets(res.bullets);
      if (res.fallback) toast(res.bullets[0] || "AI summary unavailable.", { icon: "✦" });
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "Could not generate a summary.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="AI Summary"
        subtitle="Generated from the exact KPI numbers on this dashboard"
        actions={
          <Button onClick={summarize} loading={busy} small>
            <Sparkles className="h-3.5 w-3.5" /> {bullets ? "Regenerate" : "Summarize"}
          </Button>
        }
      />
      {bullets ? (
        <div className="space-y-2 px-5 py-4">
          {bullets.map((b, i) => (
            <p key={i} className="text-sm text-slate-700">• {b}</p>
          ))}
          <AIBadge />
        </div>
      ) : (
        <p className="px-5 py-4 text-sm text-slate-400">Click “Summarize” to get 3–5 bullets about the current numbers.</p>
      )}
    </Card>
  );
}

// ---------- Admin dashboard ----------

interface AdminData {
  kpis: { headcount: number; attritionYtd: number | null; payrollCostThisMonthPaisa: number; payrollStatus: string; averageSalaryPaisa: number | null };
  headcountByDepartment: Array<{ department: string; count: number }>;
  payrollCostByDepartment: Array<{ department: string; grossPaisa: number }>;
  payrollCostByMonth: Array<{ month: string; gross: number; net: number; finalized: boolean }>;
  genderSplit: Array<{ gender: string; count: number }>;
  tenureSplit: Array<{ bucket: string; count: number }>;
  auditFeed: Array<{ id: string; at: string; actorEmail: string; action: string; entity: string }>;
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<AdminData>("/api/dashboard/admin"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <Empty title="No data yet" hint="Register employees and record activity to populate the dashboard." />;

  const k = data.kpis;
  const kpisJson = {
    headcount: k.headcount,
    attritionYtdPercent: k.attritionYtd,
    payrollCostThisMonthPKR: k.payrollCostThisMonthPaisa / 100,
    payrollStatus: k.payrollStatus,
    averageSalaryPKR: k.averageSalaryPaisa === null ? null : k.averageSalaryPaisa / 100,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="Headcount" value={k.headcount} hint="active + probation" />
        <KPI label="Attrition YTD" value={pct(k.attritionYtd)} hint="exits vs avg headcount" />
        <KPI label="Payroll cost (this month)" value={fmtPKRShort(k.payrollCostThisMonthPaisa)} hint={`run: ${k.payrollStatus}`} />
        <KPI label="Average gross salary" value={fmtPKRShort(k.averageSalaryPaisa)} hint="1.5 × basic" />
      </div>
      <Summarize dashboard="admin" kpis={kpisJson} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Headcount by department" />
          {data.headcountByDepartment.length === 0 ? (
            <Empty title="No employees yet" hint="Register employees to see the split." />
          ) : (
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.headcountByDepartment}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" name="Employees" fill="#0f172a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Payroll cost by department" subtitle="Current month run" />
          {data.payrollCostByDepartment.length === 0 ? (
            <Empty title="No payroll run this month" hint="Create a draft run in Payroll to see the cost split." />
          ) : (
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.payrollCostByDepartment.map((d) => ({ ...d, pkr: d.grossPaisa / 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`PKR ${Number(v).toLocaleString()}`, "Gross"]} />
                  <Bar dataKey="pkr" name="Gross (PKR)" fill="#475569" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Payroll cost trend" subtitle="Last 6 runs" />
          {data.payrollCostByMonth.length === 0 ? (
            <Empty title="No payroll history yet" />
          ) : (
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.payrollCostByMonth.map((m) => ({ month: m.month, gross: m.gross / 100, net: m.net / 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `PKR ${Number(v).toLocaleString()}`} />
                  <Legend />
                  <Line type="monotone" dataKey="gross" stroke="#0f172a" strokeWidth={2} />
                  <Line type="monotone" dataKey="net" stroke="#8b5cf6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Gender & tenure split" subtitle="Active employees" />
          <div className="grid grid-cols-2">
            <div className="h-56 p-2">
              {data.genderSplit.length === 0 ? <Empty title="No data" /> : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.genderSplit} dataKey="count" nameKey="gender" innerRadius={35} outerRadius={65}>
                      {data.genderSplit.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="h-56 p-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.tenureSplit} layout="vertical">
                  <XAxis type="number" allowDecimals={false} hide />
                  <YAxis dataKey="bucket" type="category" tick={{ fontSize: 11 }} width={60} />
                  <Tooltip />
                  <Bar dataKey="count" name="Employees" fill="#94a3b8" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Audit feed" subtitle="Latest 10 actions (full log in Audit)" />
        <div className="divide-y divide-slate-100">
          {data.auditFeed.length === 0 && <p className="px-5 py-6 text-center text-sm text-slate-400">No actions recorded yet.</p>}
          {data.auditFeed.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
              <span className="text-slate-600">
                <strong className="text-slate-800">{a.actorEmail}</strong> · {a.action} · {a.entity}
              </span>
              <span className="text-xs text-slate-400">{new Date(a.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- HR dashboard ----------

interface HRData {
  kpis: { headcount: number; presentToday: number; onLeaveToday: number; lateToday: number; pendingApprovals: number; pendingCorrections: number; attendanceRate: number | null; latePercent: number | null };
  trend: Array<{ date: string; present: number; late: number; absent: number; onLeave: number }>;
  absenteeismByDepartment: Array<{ department: string; absentDays: number; expectedDays: number; percent: number | null }>;
  leaveUtilization: Array<{ name: string; quota: number | null; approved: number; utilization: number | null }>;
  topLateComers: Array<{ employeeId: string; name: string; department: string | null; lateDays: number }>;
}

export function HRDashboard() {
  const [data, setData] = useState<HRData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<HRData>("/api/dashboard/hr"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const k = data.kpis;
  const kpisJson = {
    headcount: k.headcount,
    presentToday: k.presentToday,
    onLeaveToday: k.onLeaveToday,
    lateToday: k.lateToday,
    pendingApprovals: k.pendingApprovals,
    attendanceRatePercent: k.attendanceRate,
    latePercent: k.latePercent,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KPI label="Headcount" value={k.headcount} />
        <KPI label="Present today" value={k.presentToday} tone="good" />
        <KPI label="On leave today" value={k.onLeaveToday} />
        <KPI label="Late today" value={k.lateToday} tone={k.lateToday > 0 ? "warn" : "good"} />
        <KPI label="Pending approvals" value={k.pendingApprovals} tone={k.pendingApprovals > 0 ? "warn" : "good"} hint={`+${k.pendingCorrections} corrections`} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
        <KPI label="Attendance rate (30d)" value={pct(k.attendanceRate)} hint="present+late+0.5×half ÷ working records" />
        <KPI label="Late % (30d)" value={pct(k.latePercent)} hint="late ÷ (present + late)" />
      </div>
      <Summarize dashboard="hr" kpis={kpisJson} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader title="Attendance trend" subtitle="Last 14 days" />
          {data.trend.length === 0 ? (
            <Empty title="No attendance data yet" hint="Employees need to check in." />
          ) : (
            <div className="h-64 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="present" stroke="#10b981" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="late" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="absent" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="onLeave" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Absenteeism by department" subtitle="30 days" />
          {data.absenteeismByDepartment.length === 0 ? (
            <Empty title="No data" />
          ) : (
            <div className="h-56 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.absenteeismByDepartment.map((d) => ({ department: d.department, percent: d.percent ?? 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="department" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => [`${Number(v)}%`, "Absenteeism"]} />
                  <Bar dataKey="percent" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Leave utilization" subtitle="Approved days vs quota (this year)" />
          {data.leaveUtilization.length === 0 ? (
            <Empty title="No leave types" />
          ) : (
            <div className="h-56 p-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.leaveUtilization.map((u) => ({ name: u.name, percent: u.utilization ?? 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v) => [`${Number(v)}%`, "Utilization"]} />
                  <Bar dataKey="percent" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Top late-comers" subtitle="Last 30 days" />
        {data.topLateComers.length === 0 ? (
          <Empty title="No late arrivals recorded" hint="A clean sheet — everyone is on time." />
        ) : (
          <div className="divide-y divide-slate-100">
            {data.topLateComers.map((r, i) => (
              <div key={r.employeeId} className="flex items-center justify-between px-5 py-2.5 text-sm">
                <span className="text-slate-700">{i + 1}. {r.name} <span className="text-xs text-slate-400">({r.department ?? "—"})</span></span>
                <Badge value="late">{r.lateDays} lates</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Employee dashboard ----------

interface MeData {
  empty?: boolean;
  employee: { id: string; code: string; name: string; department: string | null; designation: string | null; status: string } | null;
  today: { date: string; status: string; checkIn: string | null; checkOut: string | null; isLate: boolean; workedMinutes: number | null };
  week: { start: string; end: string; minutes: number; targetMinutes: number };
  lateThisMonth: number;
  balances: Array<{ name: string; quota: number | null; approved: number; pending: number; remaining: number | null }>;
  lastPayslip: { id: string; month: number; year: number; net: number; gross: number } | null;
  upcomingLeave: Array<{ id: string; startDate: string; endDate: string; workingDays: number; status: string }>;
  announcements: Array<{ id: string; title: string; body: string; publishedAt: string }>;
}

export function EmployeeDashboard() {
  const { refresh } = useSession();
  const [data, setData] = useState<MeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<MeData>("/api/dashboard/me"));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  if (data.empty) {
    return <Empty title="No employee record linked to this account" hint="Ask HR to register you as an employee to use check-in, leave and payslips." />;
  }

  const checkIn = async () => {
    setBusy(true);
    try {
      await api.post("/api/attendance/check-in");
      toast.success("Checked in. Have a great day!");
      await load();
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Check-in failed.");
    } finally {
      setBusy(false);
    }
  };

  const checkOut = async () => {
    setBusy(true);
    try {
      await api.post("/api/attendance/check-out");
      toast.success("Checked out. See you tomorrow!");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Check-out failed.");
    } finally {
      setBusy(false);
    }
  };

  const t = data.today;
  const canCheckIn = !t.checkIn;
  const canCheckOut = Boolean(t.checkIn) && !t.checkOut;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="Hours this week" value={fmtMinutes(data.week.minutes)} hint={`target ${data.week.targetMinutes / 60}h`} tone={data.week.minutes >= data.week.targetMinutes ? "good" : "default"} />
        <KPI label="Lates this month" value={data.lateThisMonth} tone={data.lateThisMonth > 0 ? "warn" : "good"} />
        <KPI
          label="Leave balance"
          value={
            <span className="text-lg">
              {data.balances
                .filter((b) => b.remaining !== null)
                .map((b) => `${b.name}: ${b.remaining}`)
                .join(" · ") || "—"}
            </span>
          }
          hint="remaining days per type"
        />
        <KPI
          label="Last payslip (net)"
          value={data.lastPayslip ? fmtPKRShort(data.lastPayslip.net) : "—"}
          hint={data.lastPayslip ? `${monthName(data.lastPayslip.month)} ${data.lastPayslip.year}` : "no payslip yet"}
        />
      </div>

      <Card>
        <CardHeader title="Check-in" subtitle={`${t.date} · office 09:00, grace 15 min`} />
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 text-sm">
              <Badge value={t.status} />
              {t.isLate && <Badge value="late">late arrival</Badge>}
            </div>
            <p className="text-sm text-slate-600">
              <Clock className="mr-1 inline h-4 w-4 text-slate-400" />
              In: <strong>{fmtTime(t.checkIn)}</strong> · Out: <strong>{fmtTime(t.checkOut)}</strong>
              {t.workedMinutes !== null && <> · Worked: <strong>{fmtMinutes(t.workedMinutes)}</strong></>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={checkIn} disabled={!canCheckIn} loading={busy && canCheckIn}>
              <LogIn className="h-4 w-4" /> Check in
            </Button>
            <Button onClick={checkOut} disabled={!canCheckOut} loading={busy && canCheckOut} variant="secondary">
              <LogOut className="h-4 w-4" /> Check out
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming / pending leave" actions={<a href="/leave" className="text-xs font-medium text-slate-500 underline">Apply for leave</a>} />
          {data.upcomingLeave.length === 0 ? (
            <Empty title="No upcoming leave" hint="Apply from the Leave page — you can even write it as a sentence." />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.upcomingLeave.map((l) => (
                <div key={l.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                  <span className="text-slate-700">
                    <CalendarDays className="mr-1.5 inline h-4 w-4 text-slate-400" />
                    {l.startDate} → {l.endDate} ({l.workingDays}d)
                  </span>
                  <Badge value={l.status} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Announcements" actions={<a href="/announcements" className="text-xs font-medium text-slate-500 underline">View all</a>} />
          {data.announcements.length === 0 ? (
            <Empty title="No announcements yet" />
          ) : (
            <div className="divide-y divide-slate-100">
              {data.announcements.map((a) => (
                <div key={a.id} className="px-5 py-2.5">
                  <p className="text-sm font-medium text-slate-800">{a.title}</p>
                  <p className="line-clamp-2 text-xs text-slate-500">{a.body}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {data.lastPayslip && (
        <Card>
          <CardHeader
            title={`Last payslip — ${monthName(data.lastPayslip.month)} ${data.lastPayslip.year}`}
            actions={<a href={`/payslips/${data.lastPayslip.id}`} className="text-xs font-medium text-slate-500 underline">Open payslip</a>}
          />
          <div className="flex items-center gap-6 px-5 py-4 text-sm">
            <span className="flex items-center gap-1.5 text-slate-600"><Wallet className="h-4 w-4 text-slate-400" /> Gross {fmtPKR(data.lastPayslip.gross)}</span>
            <span className="font-semibold text-emerald-700">Net {fmtPKR(data.lastPayslip.net)}</span>
          </div>
        </Card>
      )}
    </div>
  );
}
