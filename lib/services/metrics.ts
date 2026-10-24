// Metrics service: ONE function per metric (Constitution Article V).
// Dashboards, exports and AI tools all call these. All metrics accept date
// range + department filters, respect caller scope, and handle empty data
// (return 0/null + "no data", never NaN).
import { db } from "@/lib/db";
import { todayIso, eachDayIso, weekdayOfIso, addDaysIso } from "@/lib/dates";
import { currentSettings, deriveStatus } from "./attendance";

export interface MetricFilters {
  from?: string;
  to?: string;
  departmentId?: string | null;
}

function scopeEmployees(departmentId?: string | null): string[] {
  let rows = db.employees.all();
  if (departmentId) rows = rows.filter((e) => e.departmentId === departmentId);
  return rows.map((e) => e.id);
}

// Headcount: employees with status active/probation on the end date.
export function headcount(filters: MetricFilters = {}): number {
  const to = filters.to || todayIso();
  const employees = filters.departmentId ? db.employees.all().filter((e) => e.departmentId === filters.departmentId) : db.employees.all();
  return employees.filter((e) => {
    if (e.joinDate > to) return false;
    if (e.status === "active" || e.status === "probation") return true;
    // exited/inactive still counted on the end date if the exit happened later
    if (e.status === "exited" && e.exitDate && e.exitDate > to) return true;
    return false;
  }).length;
}

// Attrition %: exits in period / average headcount x 100. null when no data.
export function attritionPercent(filters: MetricFilters = {}): number | null {
  const from = filters.from || `${todayIso().slice(0, 4)}-01-01`;
  const to = filters.to || todayIso();
  const all = filters.departmentId ? db.employees.all().filter((e) => e.departmentId === filters.departmentId) : db.employees.all();
  const exits = all.filter((e) => e.status === "exited" && e.exitDate && e.exitDate >= from && e.exitDate <= to).length;
  const startHc = all.filter((e) => e.joinDate <= from && !(e.exitDate && e.exitDate <= from)).length;
  const endHc = all.filter((e) => e.joinDate <= to && !(e.exitDate && e.exitDate <= to)).length;
  const avg = (startHc + endHc) / 2;
  if (avg === 0) return null; // no data
  return Math.round((exits / avg) * 1000) / 10;
}

// Attendance rate: (present + late + missing_checkout + 0.5 x half_day) /
// (working-day records - on_leave). null when denominator is 0.
export function attendanceRate(filters: MetricFilters = {}): number | null {
  const from = filters.from || addDaysIso(todayIso(), -29);
  const to = filters.to || todayIso();
  const settings = currentSettings();
  const employees = scopeEmployees(filters.departmentId);
  const holidays = new Set(db.holidays.all().map((h) => h.date));
  const counts: Record<string, number> = {};
  const recordsByEmployee = new Map<string, Map<string, ReturnType<typeof db.attendance.onDate>>>();
  for (const id of employees) {
    recordsByEmployee.set(id, new Map(db.attendance.forEmployee(id).map((a) => [a.date, a])));
  }
  const leaveByEmployee = new Map<string, Set<string>>();
  for (const l of db.leaveRequests.all()) {
    if (l.status !== "approved") continue;
    if (!employees.includes(l.employeeId)) continue;
    const set = leaveByEmployee.get(l.employeeId) ?? new Set<string>();
    for (const d of eachDayIso(l.startDate, l.endDate)) set.add(d);
    leaveByEmployee.set(l.employeeId, set);
  }
  for (const day of eachDayIso(from, to)) {
    if (day > todayIso()) continue;
    if (settings.weekend.includes(weekdayOfIso(day)) || holidays.has(day)) continue;
    for (const id of employees) {
      const emp = db.employees.byId(id);
      if (!emp || emp.joinDate > day) continue;
      const rec = recordsByEmployee.get(id)?.get(day);
      const derived = deriveStatus(id, day, rec, settings);
      counts[derived.status] = (counts[derived.status] || 0) + 1;
    }
  }
  const present = counts.present || 0;
  const late = counts.late || 0;
  const missing = counts.missing_checkout || 0;
  const half = counts.half_day || 0;
  const onLeave = counts.on_leave || 0;
  const denominator = present + late + missing + half + onLeave;
  if (denominator - onLeave <= 0) return null;
  const rate = (present + late + missing + 0.5 * half) / (denominator - onLeave);
  return Math.round(rate * 1000) / 10;
}

// Late %: late / (present + late). null when no data.
export function latePercent(filters: MetricFilters = {}): number | null {
  const from = filters.from || addDaysIso(todayIso(), -29);
  const to = filters.to || todayIso();
  const settings = currentSettings();
  const employees = scopeEmployees(filters.departmentId);
  const holidays = new Set(db.holidays.all().map((h) => h.date));
  let late = 0;
  let present = 0;
  for (const day of eachDayIso(from, to)) {
    if (day > todayIso()) continue;
    if (settings.weekend.includes(weekdayOfIso(day)) || holidays.has(day)) continue;
    for (const id of employees) {
      const emp = db.employees.byId(id);
      if (!emp || emp.joinDate > day) continue;
      const rec = db.attendance.onDate(id, day);
      const derived = deriveStatus(id, day, rec, settings);
      if (derived.status === "late") late++;
      else if (derived.status === "present") present++;
    }
  }
  if (present + late === 0) return null;
  return Math.round((late / (present + late)) * 1000) / 10;
}

// Absenteeism: absent days / expected working days (per department when grouped).
export function absenteeismByDepartment(filters: MetricFilters = {}): Array<{ departmentId: string | null; department: string; absentDays: number; expectedDays: number; percent: number | null }> {
  const from = filters.from || addDaysIso(todayIso(), -29);
  const to = filters.to || todayIso();
  const settings = currentSettings();
  const holidays = new Set(db.holidays.all().map((h) => h.date));
  const employees = db.employees.all().filter((e) => !filters.departmentId || e.departmentId === filters.departmentId);
  const groups = new Map<string | null, { absent: number; expected: number }>();
  for (const e of employees) {
    const key = e.departmentId;
    const g = groups.get(key) ?? { absent: 0, expected: 0 };
    for (const day of eachDayIso(from, to)) {
      if (day > todayIso() || day < e.joinDate) continue;
      if (settings.weekend.includes(weekdayOfIso(day)) || holidays.has(day)) continue;
      if (e.status === "exited" && e.exitDate && day > e.exitDate) continue;
      g.expected++;
      const rec = db.attendance.onDate(e.id, day);
      const derived = deriveStatus(e.id, day, rec, settings);
      if (derived.status === "absent") g.absent++;
    }
    groups.set(key, g);
  }
  return [...groups.entries()].map(([deptId, g]) => {
    const dept = deptId ? db.departments.byId(deptId) : null;
    return {
      departmentId: deptId,
      department: dept?.name ?? "Unassigned",
      absentDays: g.absent,
      expectedDays: g.expected,
      percent: g.expected === 0 ? null : Math.round((g.absent / g.expected) * 1000) / 10,
    };
  });
}

// Leave utilization: approved days / quota, per type (and department).
export function leaveUtilization(filters: MetricFilters = {}): Array<{ leaveTypeId: string; name: string; quota: number | null; approved: number; utilization: number | null }> {
  const year = (filters.to || todayIso()).slice(0, 4);
  const employees = new Set(scopeEmployees(filters.departmentId));
  return db.leaveTypes.active().map((t) => {
    let approved = 0;
    for (const l of db.leaveRequests.all()) {
      if (l.leaveTypeId !== t.id || l.status !== "approved") continue;
      if (!employees.has(l.employeeId)) continue;
      approved += l.yearSplit[year] ?? 0;
    }
    return {
      leaveTypeId: t.id,
      name: t.name,
      quota: t.quota,
      approved,
      utilization: t.quota === null || t.quota === 0 ? null : Math.round((approved / t.quota) * 1000) / 10,
    };
  });
}

// Payroll cost: sum gross & net by month (finalized runs preferred, drafts shown
// as draft). Avg salary: mean gross by department and designation.
export function payrollCostByMonth(months = 6): Array<{ month: string; gross: number; net: number; finalized: boolean }> {
  const runs = [...db.payrollRuns.all()].sort((a, b) => b.year * 12 + b.month - (a.year * 12 + a.month)).slice(0, months);
  return runs.reverse().map((r) => ({
    month: `${r.year}-${String(r.month).padStart(2, "0")}`,
    gross: r.totals.gross,
    net: r.totals.net,
    finalized: r.status === "finalized",
  }));
}

export function payrollCostByDepartment(month: number, year: number): Array<{ department: string; grossPaisa: number }> {
  const run = db.payrollRuns.byMonthYear(month, year);
  if (!run) return [];
  const slips = db.payslips.forRun(run.id);
  const map = new Map<string, number>();
  for (const s of slips) {
    const e = db.employees.byId(s.employeeId);
    const deptId = e?.departmentId ?? null;
    const name = deptId ? db.departments.byId(deptId)?.name ?? "Unassigned" : "Unassigned";
    map.set(name, (map.get(name) || 0) + s.gross);
  }
  return [...map.entries()].map(([department, grossPaisa]) => ({ department, grossPaisa }));
}

export function averageSalary(filters: MetricFilters = {}): number | null {
  const employees = scopeEmployees(filters.departmentId);
  const salaries: number[] = [];
  for (const id of employees) {
    const s = db.salaryStructures.latestFor(id);
    if (s) salaries.push(s.gross);
  }
  if (salaries.length === 0) return null;
  return Math.round(salaries.reduce((a, b) => a + b, 0) / salaries.length);
}

export function headcountByDepartment(): Array<{ department: string; count: number }> {
  const map = new Map<string, number>();
  for (const e of db.employees.all()) {
    if (e.status !== "active" && e.status !== "probation") continue;
    const name = e.departmentId ? db.departments.byId(e.departmentId)?.name ?? "Unassigned" : "Unassigned";
    map.set(name, (map.get(name) || 0) + 1);
  }
  return [...map.entries()].map(([department, count]) => ({ department, count }));
}

export function genderSplit(): Array<{ gender: string; count: number }> {
  const map = new Map<string, number>();
  for (const e of db.employees.all()) {
    if (e.status !== "active" && e.status !== "probation") continue;
    const key = e.gender ?? "unspecified";
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([gender, count]) => ({ gender, count }));
}

export function tenureSplit(): Array<{ bucket: string; count: number }> {
  const today = todayIso();
  const buckets: Record<string, number> = { "<1y": 0, "1-3y": 0, "3-5y": 0, "5y+": 0 };
  for (const e of db.employees.all()) {
    if (e.status !== "active" && e.status !== "probation") continue;
    const [y, m, d] = e.joinDate.split("-").map(Number);
    const [ty, tm, td] = today.split("-").map(Number);
    const years = (ty - y) + (tm - m) / 12 + (td - d) / 365;
    if (years < 1) buckets["<1y"]++;
    else if (years < 3) buckets["1-3y"]++;
    else if (years < 5) buckets["3-5y"]++;
    else buckets["5y+"]++;
  }
  return Object.entries(buckets).map(([bucket, count]) => ({ bucket, count }));
}

// Top late-comers for a range (for HR dashboard + AI tool parity).
export function topLateComers(filters: MetricFilters = {}, limit = 5): Array<{ employeeId: string; name: string; department: string | null; lateDays: number }> {
  const from = filters.from || addDaysIso(todayIso(), -29);
  const to = filters.to || todayIso();
  const settings = currentSettings();
  const employees = db.employees.all().filter((e) => !filters.departmentId || e.departmentId === filters.departmentId);
  const out: Array<{ employeeId: string; name: string; department: string | null; lateDays: number }> = [];
  for (const e of employees) {
    let lateDays = 0;
    for (const a of db.attendance.forEmployee(e.id)) {
      if (a.date < from || a.date > to) continue;
      const derived = deriveStatus(e.id, a.date, a, settings);
      if (derived.isLate) lateDays++;
    }
    if (lateDays > 0) {
      out.push({
        employeeId: e.id,
        name: `${e.firstName} ${e.lastName}`,
        department: e.departmentId ? db.departments.byId(e.departmentId)?.name ?? null : null,
        lateDays,
      });
    }
  }
  return out.sort((a, b) => b.lateDays - a.lateDays).slice(0, limit);
}
