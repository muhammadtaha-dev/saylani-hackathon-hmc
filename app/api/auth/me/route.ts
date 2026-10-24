import { ok, fail, requireActor } from "@/lib/api";
import { db } from "@/lib/db";
import { publicUser } from "@/lib/auth";

// GET /api/auth/me — profile + role + menu keys (mustChangePassword users may call this)
export async function GET(req: Request) {
  try {
    const actor = requireActor(req, { allowPasswordPending: true });
    const user = db.users.byId(actor.userId);
    const employee = actor.employeeId ? db.employees.byId(actor.employeeId) : null;
    return ok({
      user: user ? publicUser(user) : null,
      employee: employee
        ? {
            id: employee.id,
            code: employee.code,
            name: `${employee.firstName} ${employee.lastName}`,
            departmentId: employee.departmentId,
            status: employee.status,
          }
        : null,
      company: db.company.get()?.name ?? null,
    });
  } catch (e) {
    return fail(e);
  }
}
