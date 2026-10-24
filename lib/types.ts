// Shared domain types for HCM Lite. Money is always integer paisa (1 PKR = 100 paisa).

export type Role = "admin" | "hr" | "employee";

export type EmployeeStatus = "probation" | "active" | "inactive" | "exited";

export type AttendanceStatus =
  | "non_working"
  | "on_leave"
  | "absent"
  | "missing_checkout"
  | "half_day"
  | "late"
  | "present"
  | "checked_in";

export interface Actor {
  userId: string;
  role: Role;
  employeeId: string | null;
  email: string;
  mustChangePassword: boolean;
}

export interface Company {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  createdAt: string;
}

export interface Settings {
  id: string;
  officeStart: string; // "09:00"
  graceMinutes: number; // 0-60
  halfDayHours: number; // 1-12
  weekend: number[]; // 0=Sun..6=Sat e.g. [0,6]
  officeLat: number | null;
  officeLng: number | null;
  radiusMeters: number; // 10-5000
  effectiveFrom: string; // ISO date
  createdBy: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  employeeId: string | null;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Department {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Designation {
  id: string;
  title: string;
  departmentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveType {
  id: string;
  key: string; // annual | sick | casual | unpaid | custom
  name: string;
  quota: number | null; // days per calendar year, null = unlimited
  isPaid: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  createdAt: string;
}

export interface Employee {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  gender: "male" | "female" | "other" | null;
  dob: string | null; // YYYY-MM-DD
  joinDate: string; // YYYY-MM-DD
  exitDate: string | null;
  status: EmployeeStatus;
  departmentId: string | null;
  designationId: string | null;
  managerId: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalaryStructure {
  id: string;
  employeeId: string;
  basic: number; // paisa
  hra: number; // paisa, 40% of basic
  medical: number; // paisa, 10% of basic
  gross: number; // paisa, 1.5 x basic
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string; // YYYY-MM-DD in company timezone
  checkIn: string | null; // ISO instant
  checkOut: string | null; // ISO instant
  workedMinutes: number | null;
  status: AttendanceStatus | null; // derived for finished days; open days keep checked_in
  isLate: boolean;
  source: "web" | "camera" | "correction";
  rulesSnapshot: {
    officeStart: string;
    graceMinutes: number;
    halfDayHours: number;
    weekend: number[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface AttendanceCorrection {
  id: string;
  employeeId: string;
  date: string;
  requestedCheckIn: string | null;
  requestedCheckOut: string | null;
  reason: string;
  status: "pending" | "approved" | "rejected";
  requestedBy: string;
  decidedBy: string | null;
  decisionComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  workingDays: number;
  yearSplit: Record<string, number>; // year -> working days in that year
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  decidedBy: string | null;
  decisionComment: string | null;
  source: "form" | "ai";
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRun {
  id: string;
  month: number; // 1-12
  year: number;
  status: "draft" | "finalized";
  createdBy: string;
  finalizedBy: string | null;
  finalizedAt: string | null;
  totals: { gross: number; deductions: number; tax: number; net: number }; // paisa
  createdAt: string;
  updatedAt: string;
}

export interface Payslip {
  id: string;
  runId: string;
  employeeId: string;
  month: number;
  year: number;
  workingDays: number;
  employedDays: number;
  daysPaid: number;
  absentDays: number;
  unpaidDays: number;
  halfDays: number;
  basic: number; // paisa
  hra: number;
  medical: number;
  gross: number;
  deductionDays: number;
  deductions: number; // paisa
  taxableGross: number; // full-month gross used for tax, paisa
  tax: number; // monthly tax, paisa
  net: number; // paisa
  deductionsJson: { absentDays: number; unpaidDays: number; halfDays: number; deductionDays: number };
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  postedBy: string;
  postedByName: string;
  publishedAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  isRead: boolean;
  entityRef: string | null;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  at: string;
  actorId: string;
  actorRole: Role;
  actorEmail: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown | null;
  after: unknown | null;
}

export interface AILog {
  id: string;
  userId: string;
  role: Role;
  feature: string;
  prompt: string;
  toolCallsJson: string;
  status: string;
  latencyMs: number;
  createdAt: string;
}
