"use client";

// Attendance: HR/Admin see the daily board; employees see their own calendar.
import React, { useCallback, useEffect, useState } from "react";
import { api, ApiClientError, qs } from "@/lib/client";
import { Badge, Button, Card, Empty, ErrorState, Loading, PageHeader, Select, Table } from "@/lib/ui";
import { fmtTime, fmtMinutes } from "@/lib/format";
import { useSession } from "@/lib/session";

interface BoardRow {
  employeeId: string; code: string; name: string; department: string | null;
  status: string; isLate: boolean; checkIn: string | null; checkOut: string | null; workedMinutes: number | null;
}
interface BoardRes { date: string; isNonWorking: boolean; summary: Record<string, number>; rows: BoardRow[] }
interface DayRow { date: string; status: string; isLate: boolean; checkIn: string | null; checkOut: string | null; workedMinutes: number | null; isWeekend: boolean; isHoliday: boolean }

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AttendancePage() {
  const { user } = useSession();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [board, setBoard] = useState<BoardRes | null>(null);
  const [days, setDays] = useState<DayRow[] | null>(null);
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([]);
  const [dept, setDept] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      if (user.role === "employee") {
        const res = await api.get<{ days: DayRow[] }>(`/api/attendance/me${qs({})}`);
        setDays(res.days);
      } else {
        const res = await api.get<BoardRes>(`/api/attendance/board${qs({ date, departmentId: dept })}`);
        setBoard(res);
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load attendance.");
    } finally {
      setLoading(false);
    }
  }, [user, date, dept]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (user?.role !== "employee") {
      api.get<{ departments: Array<{ id: string; name: string }> }>("/api/departments").then((d) => setDepartments(d.departments)).catch(() => {});
    }
  }, [user]);

  if (!user) return null;

  const todayIso = new Date().toISOString().slice(0, 10);
  const shiftDay = (delta: number) => {
    const d = new Date(date + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    setDate(d.toISOString().slice(0, 10));
  };

  return (
    <div>
      <PageHeader
        title={user.role === "employee" ? "My attendance" : "Attendance board"}
        subtitle={user.role === "employee" ? "Last 30 days" : "Derived status per day: on leave > non-working > absent > missing checkout > half day > late > present"}
        actions={
          user.role !== "employee" && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" small onClick={() => shiftDay(-1)}>‹</Button>
              <input type="date" value={date} max={todayIso} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
              <Button variant="secondary" small onClick={() => shiftDay(1)} disabled={date >= todayIso}>›</Button>
            </div>
          )
        }
      />

      {user.role !== "employee" && (
        <Card className="mb-4 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dept} onChange={(e) => setDept(e.target.value)} className="!w-52">
              <option value="">All departments</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
            {board && (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(board.summary).map(([k, v]) => <Badge key={k} value={k}>{k}: {v}</Badge>)}
                {Object.keys(board.summary).length === 0 && <span className="text-xs text-slate-400">No records for this date.</span>}
                {board.isNonWorking && <Badge value="non_working">weekend / holiday</Badge>}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : user.role === "employee" ? (
          days && days.length === 0 ? (
            <Empty title="No attendance yet" hint="Check in from your dashboard to start building your calendar." />
          ) : (
            <Table head={["Date", "Day", "Status", "In", "Out", "Worked"]}>
              {days && [...days].reverse().map((d) => (
                <tr key={d.date} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-700">{d.date} <span className="text-xs text-slate-400">{WD[new Date(d.date + "T00:00:00Z").getUTCDay()]}</span></td>
                  <td className="px-4 py-2.5">{d.isWeekend || d.isHoliday ? <Badge value="non_working">{d.isHoliday ? "holiday" : "weekend"}</Badge> : <span className="text-xs text-slate-400">working day</span>}</td>
                  <td className="px-4 py-2.5"><Badge value={d.status} /> {d.isLate && d.status !== "late" ? <Badge value="late">late</Badge> : null}</td>
                  <td className="px-4 py-2.5">{fmtTime(d.checkIn)}</td>
                  <td className="px-4 py-2.5">{fmtTime(d.checkOut)}</td>
                  <td className="px-4 py-2.5">{fmtMinutes(d.workedMinutes)}</td>
                </tr>
              ))}
            </Table>
          )
        ) : board && board.rows.length === 0 ? (
          <Empty title="No active employees" hint="Register employees first." />
        ) : board ? (
          <Table head={["Code", "Employee", "Department", "Status", "In", "Out", "Worked"]}>
            {board.rows.map((r) => (
              <tr key={r.employeeId} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.code}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.department ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge value={r.status} /> {r.isLate && r.status !== "late" ? <Badge value="late">late</Badge> : null}</td>
                <td className="px-4 py-2.5">{fmtTime(r.checkIn)}</td>
                <td className="px-4 py-2.5">{fmtTime(r.checkOut)}</td>
                <td className="px-4 py-2.5">{fmtMinutes(r.workedMinutes)}</td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Card>
    </div>
  );
}
