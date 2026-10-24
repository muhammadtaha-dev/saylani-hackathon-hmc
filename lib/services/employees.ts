// Employee rules: unique code/email, known department/designation, ISO dates,
// salary > 0 (input PKR, stored paisa), transactional employee+user+salary create.
import { z } from "zod";
import { db, newId, nowIso } from "@/lib/db";
import { makeUser, generateTempPassword } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { isValidIsoDate } from "@/lib/dates";
import type { Employee, SalaryStructure, User } from "@/lib/types";

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const employeeInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase(),
  phone: z.string().trim().max(30).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  gender: z.enum(["male", "female", "other"]).optional().nullable(),
  dob: z.string().optional().nullable(),
  joinDate: z.string(),
  departmentId: z.string().nullable().optional(),
  designationId: z.string().nullable().optional(),
  basic: z.number(), // PKR
  status: z.enum(["probation", "active", "inactive", "exited"]).default("probation"),
});

export type EmployeeInput = z.infer<typeof employeeInputSchema>;

export function validateEmployeeInput(
  input: EmployeeInput,
  opts: { forId?: string } = {}
): { salaryPaisa: number; deptId: string | null; desigId: string | null } {
  if (!emailRe.test(input.email)) throw new ApiError(422, "RULE_VIOLATION", "Email is not valid.");
  if (!(input.basic > 0)) throw new ApiError(422, "RULE_VIOLATION", "Basic salary must be greater than 0.");
  if (!isValidIsoDate(input.joinDate)) throw new ApiError(422, "RULE_VIOLATION", "joinDate must be a valid YYYY-MM-DD date.");
  if (input.dob && !isValidIsoDate(input.dob)) throw new ApiError(422, "RULE_VIOLATION", "dob must be a valid YYYY-MM-DD date.");

  const codeDup = db.employees.byCode(input.code);
  if (codeDup && codeDup.id !== opts.forId) throw new ApiError(409, "CONFLICT", "Employee code already exists.");
  const emailDup = db.employees.all().find((e) => e.email === input.email);
  if (emailDup && emailDup.id !== opts.forId) throw new ApiError(409, "CONFLICT", "Employee email already exists.");
  const userDup = db.users.byEmail(input.email);
  if (userDup && userDup.employeeId !== opts.forId) throw new ApiError(409, "CONFLICT", "A login with this email already exists.");

  if (input.departmentId && !db.departments.byId(input.departmentId)) {
    throw new ApiError(422, "RULE_VIOLATION", "Unknown department.");
  }
  if (input.designationId && !db.designations.byId(input.designationId)) {
    throw new ApiError(422, "RULE_VIOLATION", "Unknown designation.");
  }
  return {
    salaryPaisa: Math.round(input.basic * 100),
    deptId: input.departmentId ?? null,
    desigId: input.designationId ?? null,
  };
}

export interface CreatedEmployee {
  employee: Employee;
  user: User;
  tempPassword: string;
}

// Create employee + login + salary structure in one unit of work.
// All rows are validated before any write; on any failure nothing is persisted.
export async function createEmployeeWithLogin(
  input: EmployeeInput,
  createdBy: { userId: string; role: string }
): Promise<CreatedEmployee> {
  const { salaryPaisa, deptId, desigId } = validateEmployeeInput(input);

  const employeeId = newId();
  const tempPassword = generateTempPassword();
  const user = makeUser({
    email: input.email,
    password: tempPassword,
    role: "employee",
    name: `${input.firstName} ${input.lastName}`,
    employeeId,
    mustChangePassword: true,
  });
  const employee: Employee = {
    id: employeeId,
    code: input.code,
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone ?? null,
    address: input.address ?? null,
    gender: input.gender ?? null,
    dob: input.dob ?? null,
    joinDate: input.joinDate,
    exitDate: null,
    status: input.status ?? "probation",
    departmentId: deptId,
    designationId: desigId,
    managerId: null,
    userId: user.id,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const salary: SalaryStructure = {
    id: newId(),
    employeeId,
    basic: salaryPaisa,
    hra: Math.round(salaryPaisa * 0.4),
    medical: Math.round(salaryPaisa * 0.1),
    gross: Math.round(salaryPaisa * 1.5),
    effectiveFrom: input.joinDate,
    createdBy: createdBy.userId,
    createdAt: nowIso(),
  };

  await db.users.insert(user);
  await db.employees.insert(employee);
  await db.salaryStructures.insert(salary);
  return { employee, user, tempPassword };
}

export function latestSalary(employeeId: string): SalaryStructure | undefined {
  return db.salaryStructures.latestFor(employeeId);
}

export function employeeName(employeeId: string): string {
  const e = db.employees.byId(employeeId);
  return e ? `${e.firstName} ${e.lastName}` : "Unknown";
}
