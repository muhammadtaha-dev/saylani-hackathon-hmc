// First-run setup: creates company + Admin + initial settings + default leave
// types (the ONLY automatic seeds). Idempotent-guarded: works exactly once.
import { db, newId, nowIso } from "../db";
import { makeUser } from "../auth";
import { ApiError } from "../api";
import { audit } from "../audit";
import type { LeaveType, Settings } from "../types";

export const DEFAULT_LEAVE_TYPES: Array<{ key: string; name: string; quota: number | null; isPaid: boolean }> = [
  { key: "annual", name: "Annual", quota: 14, isPaid: true },
  { key: "sick", name: "Sick", quota: 8, isPaid: true },
  { key: "casual", name: "Casual", quota: 10, isPaid: true },
  { key: "unpaid", name: "Unpaid", quota: null, isPaid: false },
];

export function defaultSettings(adminId: string): Settings {
  return {
    id: newId(),
    officeStart: "09:00",
    graceMinutes: 15,
    halfDayHours: 5,
    weekend: [0, 6], // Sunday + Saturday
    officeLat: null,
    officeLng: null,
    radiusMeters: 150,
    effectiveFrom: nowIso().slice(0, 10),
    createdBy: adminId,
    createdAt: nowIso(),
  };
}

export async function performSetup(input: {
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  officeStart?: string;
  graceMinutes?: number;
  timezone?: string;
}): Promise<{ adminEmail: string }> {
  if (db.company.get()) {
    throw new ApiError(409, "ALREADY_INITIALIZED", "Setup has already been completed.");
  }
  const admin = makeUser({
    email: input.adminEmail,
    password: input.adminPassword,
    role: "admin",
    name: input.adminName,
    mustChangePassword: false,
  });
  await db.users.insert(admin);

  await db.company.set({
    id: newId(),
    name: input.companyName,
    timezone: input.timezone || process.env.TZ_NAME || "Asia/Karachi",
    currency: "PKR",
    createdAt: nowIso(),
  });

  const settings = defaultSettings(admin.id);
  if (input.officeStart) settings.officeStart = input.officeStart;
  if (typeof input.graceMinutes === "number") settings.graceMinutes = input.graceMinutes;
  await db.settings.insert(settings);

  for (const lt of DEFAULT_LEAVE_TYPES) {
    const row: LeaveType = {
      id: newId(),
      key: lt.key,
      name: lt.name,
      quota: lt.quota,
      isPaid: lt.isPaid,
      isActive: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.leaveTypes.insert(row);
  }

  await audit(null, "setup", "company", null, null, { companyName: input.companyName, adminEmail: admin.email });
  await audit(null, "seed", "leave_types", null, null, { seeded: DEFAULT_LEAVE_TYPES.map((t) => t.key) });
  return { adminEmail: admin.email };
}

export function getSettingsVersioned(): Settings | null {
  return db.settings.latest();
}
