import { ok, fail, requireActor, ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { createEmployeeWithLogin, validateEmployeeInput } from "@/lib/services/employees";

// GET /api/employees/import (documented shape) — handled by POST with ?dryRun.
// Columns: code,firstName,lastName,email,phone,department,designation,joinDate,gender,basic
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

function departmentIdByName(name: string): string | null {
  const d = db.departments.all().find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
  return d?.id ?? null;
}

function designationIdByTitle(title: string): string | null {
  const d = db.designations.all().find((x) => x.title.toLowerCase() === title.trim().toLowerCase());
  return d?.id ?? null;
}

// POST /api/employees/import?dryRun=true|false (CSV body as text/csv)
export async function POST(req: Request) {
  try {
    const actor = requireActor(req, { roles: ["admin", "hr"] });
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dryRun") !== "false";
    const text = await req.text();
    const rows = parseCsv(text);
    if (rows.length === 0) {
      return ok({ validRows: 0, errors: [{ row: 1, field: "file", reason: "CSV file is empty." }] });
    }
    const header = rows[0].map((h) => h.trim());
    const expected = ["code", "firstName", "lastName", "email", "phone", "department", "designation", "joinDate", "gender", "basic"];
    const headerOk = expected.every((col) => header.includes(col));
    if (!headerOk) {
      return ok({ validRows: 0, errors: [{ row: 1, field: "header", reason: `Header must contain: ${expected.join(", ")}` }] });
    }
    const idx = (col: string) => header.indexOf(col);

    const errors: Array<{ row: number; field: string; reason: string }> = [];
    const parsed: Array<Parameters<typeof createEmployeeWithLogin>[0]> = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (col: string) => (idx(col) >= 0 && idx(col) < cells.length ? cells[idx(col)].trim() : "");
      const basicRaw = get("basic");
      const basic = parseFloat(basicRaw);
      const input = {
        code: get("code"),
        firstName: get("firstName"),
        lastName: get("lastName"),
        email: get("email").toLowerCase(),
        phone: get("phone") || null,
        address: null,
        gender: (["male", "female", "other"].includes(get("gender").toLowerCase()) ? get("gender").toLowerCase() : null) as "male" | "female" | "other" | null,
        dob: null,
        joinDate: get("joinDate"),
        departmentId: get("department") ? departmentIdByName(get("department")) : null,
        designationId: get("designation") ? designationIdByTitle(get("designation")) : null,
        basic: isNaN(basic) ? 0 : basic,
        status: "probation" as const,
      };
      let rowFailed = false;
      const addError = (field: string, reason: string) => {
        errors.push({ row: r + 1, field, reason });
        rowFailed = true;
      };
      if (!input.code) addError("code", "Employee code is required.");
      if (!input.firstName) addError("firstName", "First name is required.");
      if (!input.lastName) addError("lastName", "Last name is required.");
      if (!input.email) addError("email", "Email is required.");
      if (get("department") && !input.departmentId) addError("department", `Unknown department "${get("department")}".`);
      if (get("designation") && !input.designationId) addError("designation", `Unknown designation "${get("designation")}".`);
      if (isNaN(basic) || basic <= 0) addError("basic", "Basic salary must be a number greater than 0.");
      if (!rowFailed) {
        try {
          validateEmployeeInput(input);
        } catch (e) {
          const err = e as { details?: Array<{ field: string; reason: string }>; message?: string };
          if (err.details?.length) err.details.forEach((d) => addError(d.field, d.reason));
          else addError("row", err.message || "Invalid row.");
          rowFailed = true;
        }
      }
      if (!rowFailed) parsed.push(input);
    }

    if (dryRun) {
      return ok({ validRows: parsed.length, errors, dryRun: true });
    }
    // Ruling: all-or-nothing. Commit only when the dry run passed with zero errors.
    if (errors.length > 0 || parsed.length === 0) {
      throw new ApiError(422, "RULE_VIOLATION", "Import refused: fix all errors in the dry run first.", { errors });
    }
    const created: string[] = [];
    const tempPasswords: Array<{ code: string; email: string; tempPassword: string }> = [];
    for (const input of parsed) {
      const createdRow = await createEmployeeWithLogin(input, { userId: actor.userId, role: actor.role });
      created.push(createdRow.employee.id);
      tempPasswords.push({ code: createdRow.employee.code, email: createdRow.employee.email, tempPassword: createdRow.tempPassword });
    }
    await audit(actor, "import", "employee", null, null, { imported: created.length });
    return ok({ validRows: created.length, errors: [], committed: true, tempPasswords });
  } catch (e) {
    return fail(e);
  }
}

// GET /api/employees/import — not used; keep method shape explicit.
export async function GET() {
  return ok({ message: "POST CSV content with ?dryRun=true|false" });
}
