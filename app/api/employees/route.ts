import { z } from "zod";
import { ok, fail, parseBody, readJson, requireActor, ApiError, paginate, paged } from "@/lib/api";
import { audit, notify } from "@/lib/audit";
import { createEmployeeWithLogin, employeeInputSchema, validateEmployeeInput } from "@/lib/services/employees";
import { hashPassword, generateTempPassword } from "@/lib/auth";
import { db, newId, nowIso } from "@/lib/db";

// GET /api/employees?search=&departmentId=&designationId=&status=&page=&limit=
// Employee role sees only self (FR-M3-03).
export async function GET(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    if (actor.role === "employee") {
      const me = actor.employeeId ? db.employees.byId(actor.employeeId) : null;
      return paged({ data: me ? [viewRow(me)] : [], page: 1, limit: 20, total: me ? 1 : 0 });
    }
    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const departmentId = url.searchParams.get("departmentId") || "";
    const designationId = url.searchParams.get("designationId") || "";
    const status = url.searchParams.get("status") || "";

    let rows = db.employees.all();
    if (search) {
      rows = rows.filter((e) =>
        [e.code, e.firstName, e.lastName, e.email].join(" ").toLowerCase().includes(search)
      );
    }
    if (departmentId) rows = rows.filter((e) => e.departmentId === departmentId);
    if (designationId) rows = rows.filter((e) => e.designationId === designationId);
    if (status) rows = rows.filter((e) => e.status === status);
    rows = [...rows].sort((a, b) => a.code.localeCompare(b.code));
    const page = paginate(rows, url.searchParams.get("page"), url.searchParams.get("limit"));
    return paged({
      data: page.data.map(viewRow),
      page: page.page,
      limit: page.limit,
      total: page.total,
    });
  } catch (e) {
    return fail(e);
  }
}

function viewRow(e: ReturnType<typeof db.employees.byId> & object) {
  const dept = e.departmentId ? db.departments.byId(e.departmentId) : null;
  const desig = e.designationId ? db.designations.byId(e.designationId) : null;
  const user = db.users.byId(e.userId);
  return {
    id: e.id,
    code: e.code,
    firstName: e.firstName,
    lastName: e.lastName,
    email: e.email,
    phone: e.phone,
    gender: e.gender,
    joinDate: e.joinDate,
    exitDate: e.exitDate,
    status: e.status,
    departmentId: e.departmentId,
    departmentName: dept?.name ?? null,
    designationId: e.designationId,
    designationTitle: desig?.title ?? null,
    userActive: user?.isActive ?? false,
    createdAt: e.createdAt,
  };
}

// POST /api/employees — HR registers employee (+login+salary), temp password once
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["hr", "admin"] });
    const input = parseBody(employeeInputSchema, await readJson(req));
    const created = await createEmployeeWithLogin(input, { userId: actor.userId, role: actor.role });
    const salary = db.salaryStructures.latestFor(created.employee.id);
    await audit(actor, "create", "employee", created.employee.id, null, {
      code: created.employee.code,
      email: created.employee.email,
      basicPaisa: salary?.basic ?? null,
    });
    return ok(
      {
        employee: { ...created.employee, passwordHash: undefined },
        tempPassword: created.tempPassword,
      },
      201
    );
  } catch (e) {
    return fail(e);
  }
}

// PATCH /api/employees?id=... — HR all fields; Employee only own phone/address
export async function PATCH(req: Request) {
  try {
    const actor = requireActor(req);
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const before = db.employees.byId(id);
    if (!before) throw new ApiError(404, "NOT_FOUND", "Employee not found.");

    const body = (await readJson(req)) as Record<string, unknown>;

    if (actor.role === "employee") {
      if (id !== actor.employeeId) throw new ApiError(403, "FORBIDDEN", "You can only edit your own profile.");
      const patch = z
        .object({ phone: z.string().trim().max(30).nullable().optional(), address: z.string().trim().max(300).nullable().optional() })
        .parse(body);
      const after = db.employees.update(id, patch);
      await db.employees.flush();
      await audit(actor, "update", "employee", id, before, after);
      return ok(after);
    }

    // HR/Admin full edit: merge submitted fields on top of existing, revalidate.
    const input = employeeInputSchema.parse({
      code: body.code ?? before.code,
      firstName: body.firstName ?? before.firstName,
      lastName: body.lastName ?? before.lastName,
      email: String(body.email ?? before.email).toLowerCase(),
      phone: body.phone ?? before.phone,
      address: body.address ?? before.address,
      gender: body.gender ?? before.gender,
      dob: body.dob ?? before.dob,
      joinDate: body.joinDate ?? before.joinDate,
      departmentId: body.departmentId ?? before.departmentId,
      designationId: body.designationId ?? before.designationId,
      status: body.status ?? before.status,
      basic: body.basic ?? latestBasicForView(id),
    });
    const { salaryPaisa, deptId, desigId } = validateEmployeeInput(input, { forId: id });
    const after = db.employees.update(id, {
      code: input.code,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone ?? null,
      address: input.address ?? null,
      gender: input.gender ?? null,
      dob: input.dob ?? null,
      joinDate: input.joinDate,
      departmentId: deptId,
      designationId: desigId,
      status: input.status,
      exitDate: input.status === "exited" ? (body.exitDate as string) || nowIso().slice(0, 10) : null,
    });
    await db.employees.flush();

    // New salary row when basic changed (history kept with effectiveFrom)
    const currentSalary = db.salaryStructures.latestFor(id);
    if (currentSalary && currentSalary.basic !== salaryPaisa) {
      await db.salaryStructures.insert({
        id: newId(),
        employeeId: id,
        basic: salaryPaisa,
        hra: Math.round(salaryPaisa * 0.4),
        medical: Math.round(salaryPaisa * 0.1),
        gross: Math.round(salaryPaisa * 1.5),
        effectiveFrom: nowIso().slice(0, 10),
        createdBy: actor.userId,
        createdAt: nowIso(),
      });
    }

    // Setting status exited deactivates the login (FR-M3-07)
    if (input.status === "exited") {
      const user = db.users.byId(before.userId);
      if (user?.isActive) {
        db.users.update(before.userId, { isActive: false });
        await db.users.flush();
      }
    }

    await audit(actor, "update", "employee", id, before, after);
    return ok(after);
  } catch (e) {
    return fail(e);
  }
}

function latestBasicForView(employeeId: string): number {
  const s = db.salaryStructures.latestFor(employeeId);
  return s ? s.basic / 100 : 0;
}

// PUT /api/employees?id=...&action=password — HR resets an employee's password
export async function PUT(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["hr", "admin"] });
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) throw new ApiError(400, "VALIDATION", "id query param is required.");
    const employee = db.employees.byId(id);
    if (!employee) throw new ApiError(404, "NOT_FOUND", "Employee not found.");
    const tempPassword = generateTempPassword();
    const user = db.users.byId(employee.userId);
    if (!user) throw new ApiError(404, "NOT_FOUND", "Employee login not found.");
    db.users.update(user.id, { passwordHash: hashPassword(tempPassword), mustChangePassword: true });
    await db.users.flush();
    await notify(user.id, "password_reset", "Password reset", "Your password was reset by HR. Sign in with the new temporary password.");
    await audit(actor, "reset_password", "user", user.id, null, { employeeId: id });
    return ok({ tempPassword });
  } catch (e) {
    return fail(e);
  }
}
