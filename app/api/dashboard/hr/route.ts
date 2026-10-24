import { ok, fail, requireActor } from "@/lib/api";
import { db } from "@/lib/db";
import { todayIso, addDaysIso } from "@/lib/dates";
import { headcount, attendanceRate, latePercent, absenteeismByDepartment, leaveUtilization, topLateComers } from "@/lib/services/metrics";
import { currentSettings, deriveStatus } from "@/lib/services/attendance";

// GET /api/dashboard/hr?from=&to=&departmentId= — HR operational KPIs.
export async function GET(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    void actor;
    const url = new URL(req.url);
    const today = todayIso();
    const from = url.searchParams.get("from") || addDaysIso(today, -29);
    const to = url.searchParams.get("to") || today;
    const departmentId = url.searchParams.get("departmentId") || null;
    const filters = { from, to, departmentId };

    // Today snapshot
    const settings = currentSettings();
    const employees = db.employees.all().filter((e) => e.status === "active" || e.status === "probation");
    let todayRows = employees;
    if (departmentId) todayRows = todayRows.filter((e) => e.departmentId === departmentId);
    const todayStatuses = todayRows.map((e) => deriveStatus(e.id, today, db.attendance.onDate(e.id, today), settings));
    const presentToday = todayStatuses.filter((s) => ["present", "late", "half_day", "missing_checkout"].includes(s.status)).length;
    const onLeaveToday = todayStatuses.filter((s) => s.status === "on_leave").length;
    const lateToday = todayStatuses.filter((s) => s.isLate).length;
    const pendingApprovals = db.leaveRequests.all().filter((l) => l.status === "pending").length;
    const pendingCorrections = db.corrections.all().filter((c) => c.status === "pending").length;

    // Attendance trend (last 14 days)
    const trend = eachDay(from, to)
      .slice(-14)
      .map((day) => {
        let present = 0;
        let late = 0;
        let absent = 0;
        let onLeave = 0;
        for (const e of todayRows) {
          if (e.joinDate > day) continue;
          const rec = db.attendance.onDate(e.id, day);
          const d = deriveStatus(e.id, day, rec, settings);
          if (d.status === "present" || d.status === "checked_in") present++;
          else if (d.status === "late") late++;
          else if (d.status === "absent") absent++;
          else if (d.status === "on_leave") onLeave++;
        }
        return { date: day, present, late, absent, onLeave };
      });

    return ok({
      kpis: {
        headcount: headcount({ to }),
        presentToday,
        onLeaveToday,
        lateToday,
        pendingApprovals,
        pendingCorrections,
        attendanceRate: attendanceRate(filters),
        latePercent: latePercent(filters),
      },
      trend,
      absenteeismByDepartment: absenteeismByDepartment(filters),
      leaveUtilization: leaveUtilization(filters),
      topLateComers: topLateComers(filters, 5),
    });
  } catch (e) {
    return fail(e);
  }
}

function eachDay(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a;
  let guard = 0;
  while (cur <= b && guard < 400) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    cur = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    guard++;
  }
  return out;
}
