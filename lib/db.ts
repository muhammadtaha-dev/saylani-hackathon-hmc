// JSON-file backed persistence. Starts completely empty, survives restarts via
// atomic writes (tmp file + rename). All business data lives here; no seeds
// except default leave types created by first-run setup.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Announcement,
  AttendanceCorrection,
  AttendanceRecord,
  AuditLog,
  AILog,
  Company,
  Department,
  Designation,
  Employee,
  Holiday,
  LeaveRequest,
  LeaveType,
  Notification,
  PayrollRun,
  Payslip,
  SalaryStructure,
  Settings,
  User,
} from "./types";

interface DbShape {
  company: Company | null;
  settings: Settings[];
  users: User[];
  departments: Department[];
  designations: Designation[];
  leaveTypes: LeaveType[];
  holidays: Holiday[];
  employees: Employee[];
  salaryStructures: SalaryStructure[];
  attendance: AttendanceRecord[];
  attendanceCorrections: AttendanceCorrection[];
  leaveRequests: LeaveRequest[];
  payrollRuns: PayrollRun[];
  payslips: Payslip[];
  announcements: Announcement[];
  notifications: Notification[];
  auditLogs: AuditLog[];
  aiLogs: AILog[];
}

const COLLECTIONS: (keyof DbShape)[] = [
  "company",
  "settings",
  "users",
  "departments",
  "designations",
  "leaveTypes",
  "holidays",
  "employees",
  "salaryStructures",
  "attendance",
  "attendanceCorrections",
  "leaveRequests",
  "payrollRuns",
  "payslips",
  "announcements",
  "notifications",
  "auditLogs",
  "aiLogs",
];

const emptyDb = (): DbShape => ({
  company: null,
  settings: [],
  users: [],
  departments: [],
  designations: [],
  leaveTypes: [],
  holidays: [],
  employees: [],
  salaryStructures: [],
  attendance: [],
  attendanceCorrections: [],
  leaveRequests: [],
  payrollRuns: [],
  payslips: [],
  announcements: [],
  notifications: [],
  auditLogs: [],
  aiLogs: [],
});

function dataDir(): string {
  // Vercel's serverless filesystem is read-only outside /tmp; use a temp dir
  // there (persists for the life of the warm instance). Local runs use ./data.
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.VERCEL === "1") return "/tmp/hcm-data";
  return path.join(process.cwd(), "data");
}

function dbFile(): string {
  return path.join(dataDir(), "hcm.json");
}

let cache: DbShape | null = null;
let cacheMtime = 0;
let writeChain: Promise<void> = Promise.resolve();

// Each route bundle holds its own module instance, so a load-once cache goes
// stale the moment another route flushes. Reload whenever the file's mtime
// moved (stat is cheap at demo scale; correctness beats caching here).
function load(): DbShape {
  let mtime: number | null = null;
  try {
    mtime = fs.statSync(dbFile()).mtimeMs;
  } catch {
    mtime = null;
  }
  let result: DbShape = cache ?? emptyDb();
  if (!cache || (mtime !== null && mtime !== cacheMtime)) {
    try {
      const raw = fs.readFileSync(dbFile(), "utf8");
      result = { ...emptyDb(), ...(JSON.parse(raw) as Partial<DbShape>) };
      cache = result;
      cacheMtime = mtime ?? 0;
    } catch {
      if (!cache) cache = result;
    }
  }
  return result;
}

function flush(): Promise<void> {
  const data = load();
  const dir = dataDir();
  const file = dbFile();
  const tmp = file + ".tmp";
  const json = JSON.stringify(data, null, 1);
  writeChain = writeChain
    .then(() => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmp, json, "utf8");
      fs.renameSync(tmp, file);
      cacheMtime = fs.statSync(file).mtimeMs;
    })
    .catch((e) => {
      // Persist failures are surfaced but never crash a request mid-handler.
      console.error("[db] flush failed:", (e as Error).message);
    });
  return writeChain;
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export const db = {
  company: {
    get(): Company | null {
      return load().company;
    },
    set(c: Company) {
      load().company = c;
      return flush();
    },
  },
  settings: {
    all(): Settings[] {
      return load().settings;
    },
    latest(): Settings | null {
      const all = load().settings;
      return all.length ? all[all.length - 1] : null;
    },
    insert(s: Settings) {
      load().settings.push(s);
      return flush();
    },
  },
  users: {
    all(): User[] {
      return load().users;
    },
    byId(id: string): User | undefined {
      return load().users.find((u) => u.id === id);
    },
    byEmail(email: string): User | undefined {
      const e = email.trim().toLowerCase();
      return load().users.find((u) => u.email === e);
    },
    insert(u: User) {
      load().users.push(u);
      return flush();
    },
    update(id: string, patch: Partial<User>): User | undefined {
      const users = load().users;
      const i = users.findIndex((u) => u.id === id);
      if (i === -1) return undefined;
      users[i] = { ...users[i], ...patch, updatedAt: nowIso() };
      return users[i];
    },
    flush,
  },
  departments: {
    all(): Department[] {
      return load().departments;
    },
    byId(id: string) {
      return load().departments.find((d) => d.id === id);
    },
    insert(d: Department) {
      load().departments.push(d);
      return flush();
    },
    update(id: string, patch: Partial<Department>) {
      const list = load().departments;
      const i = list.findIndex((d) => d.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  designations: {
    all(): Designation[] {
      return load().designations;
    },
    byId(id: string) {
      return load().designations.find((d) => d.id === id);
    },
    insert(d: Designation) {
      load().designations.push(d);
      return flush();
    },
    update(id: string, patch: Partial<Designation>) {
      const list = load().designations;
      const i = list.findIndex((d) => d.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  leaveTypes: {
    all(): LeaveType[] {
      return load().leaveTypes;
    },
    active(): LeaveType[] {
      return load().leaveTypes.filter((t) => t.isActive);
    },
    byId(id: string) {
      return load().leaveTypes.find((t) => t.id === id);
    },
    insert(t: LeaveType) {
      load().leaveTypes.push(t);
      return flush();
    },
    update(id: string, patch: Partial<LeaveType>) {
      const list = load().leaveTypes;
      const i = list.findIndex((t) => t.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  holidays: {
    all(): Holiday[] {
      return load().holidays;
    },
    byDate(date: string) {
      return load().holidays.find((h) => h.date === date);
    },
    insert(h: Holiday) {
      load().holidays.push(h);
      return flush();
    },
    remove(id: string) {
      const list = load().holidays;
      const i = list.findIndex((h) => h.id === id);
      if (i === -1) return false;
      list.splice(i, 1);
      return true;
    },
    flush,
  },
  employees: {
    all(): Employee[] {
      return load().employees;
    },
    byId(id: string) {
      return load().employees.find((e) => e.id === id);
    },
    byCode(code: string) {
      const c = code.trim().toLowerCase();
      return load().employees.find((e) => e.code.toLowerCase() === c);
    },
    insert(e: Employee) {
      load().employees.push(e);
      return flush();
    },
    update(id: string, patch: Partial<Employee>) {
      const list = load().employees;
      const i = list.findIndex((e) => e.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  salaryStructures: {
    all(): SalaryStructure[] {
      return load().salaryStructures;
    },
    latestFor(employeeId: string): SalaryStructure | undefined {
      const rows = load().salaryStructures.filter((s) => s.employeeId === employeeId);
      rows.sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
      return rows[rows.length - 1];
    },
    insert(s: SalaryStructure) {
      load().salaryStructures.push(s);
      return flush();
    },
    flush,
  },
  attendance: {
    all(): AttendanceRecord[] {
      return load().attendance;
    },
    forEmployee(employeeId: string) {
      return load().attendance.filter((a) => a.employeeId === employeeId);
    },
    onDate(employeeId: string, date: string) {
      return load().attendance.find((a) => a.employeeId === employeeId && a.date === date);
    },
    insert(a: AttendanceRecord) {
      load().attendance.push(a);
      return flush();
    },
    update(id: string, patch: Partial<AttendanceRecord>) {
      const list = load().attendance;
      const i = list.findIndex((a) => a.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  corrections: {
    all(): AttendanceCorrection[] {
      return load().attendanceCorrections;
    },
    byId(id: string) {
      return load().attendanceCorrections.find((c) => c.id === id);
    },
    insert(c: AttendanceCorrection) {
      load().attendanceCorrections.push(c);
      return flush();
    },
    update(id: string, patch: Partial<AttendanceCorrection>) {
      const list = load().attendanceCorrections;
      const i = list.findIndex((c) => c.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  leaveRequests: {
    all(): LeaveRequest[] {
      return load().leaveRequests;
    },
    byId(id: string) {
      return load().leaveRequests.find((l) => l.id === id);
    },
    insert(l: LeaveRequest) {
      load().leaveRequests.push(l);
      return flush();
    },
    update(id: string, patch: Partial<LeaveRequest>) {
      const list = load().leaveRequests;
      const i = list.findIndex((l) => l.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  payrollRuns: {
    all(): PayrollRun[] {
      return load().payrollRuns;
    },
    byId(id: string) {
      return load().payrollRuns.find((r) => r.id === id);
    },
    byMonthYear(month: number, year: number) {
      return load().payrollRuns.find((r) => r.month === month && r.year === year);
    },
    insert(r: PayrollRun) {
      load().payrollRuns.push(r);
      return flush();
    },
    update(id: string, patch: Partial<PayrollRun>) {
      const list = load().payrollRuns;
      const i = list.findIndex((r) => r.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch, updatedAt: nowIso() };
      return list[i];
    },
    flush,
  },
  payslips: {
    all(): Payslip[] {
      return load().payslips;
    },
    byId(id: string) {
      return load().payslips.find((p) => p.id === id);
    },
    forRun(runId: string) {
      return load().payslips.filter((p) => p.runId === runId);
    },
    insert(p: Payslip) {
      load().payslips.push(p);
      return flush();
    },
    replaceForRun(runId: string, rows: Payslip[]) {
      const list = load().payslips;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].runId === runId) list.splice(i, 1);
      }
      list.push(...rows);
      return flush();
    },
    flush,
  },
  announcements: {
    all(): Announcement[] {
      return [...load().announcements].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
    },
    insert(a: Announcement) {
      load().announcements.push(a);
      return flush();
    },
    flush,
  },
  notifications: {
    forUser(userId: string): Notification[] {
      return load()
        .notifications.filter((n) => n.userId === userId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    unreadCount(userId: string): number {
      return load().notifications.filter((n) => n.userId === userId && !n.isRead).length;
    },
    insert(n: Notification) {
      load().notifications.push(n);
      return flush();
    },
    update(id: string, patch: Partial<Notification>) {
      const list = load().notifications;
      const i = list.findIndex((n) => n.id === id);
      if (i === -1) return undefined;
      list[i] = { ...list[i], ...patch };
      return list[i];
    },
    markAllRead(userId: string) {
      for (const n of load().notifications) {
        if (n.userId === userId) n.isRead = true;
      }
      return flush();
    },
    flush,
  },
  auditLogs: {
    all(): AuditLog[] {
      return [...load().auditLogs].sort((a, b) => (a.at < b.at ? 1 : -1));
    },
    insert(a: AuditLog) {
      load().auditLogs.push(a);
      return flush();
    },
    flush,
  },
  aiLogs: {
    all(): AILog[] {
      return [...load().aiLogs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    insert(l: AILog) {
      load().aiLogs.push(l);
      return flush();
    },
    flush,
  },
};

export function isInitialized(): boolean {
  return load().company !== null;
}

export async function awaitPersistence(): Promise<void> {
  await writeChain;
}

// Test/reset hook used only by the reset endpoint (Admin).
export function resetAll(): Promise<void> {
  cache = emptyDb();
  return flush();
}

export function collectionStats(): Record<string, number> {
  const d = load();
  const out: Record<string, number> = {};
  for (const key of COLLECTIONS) {
    const v = d[key];
    out[key] = v === null ? 0 : Array.isArray(v) ? v.length : 1;
  }
  return out;
}
