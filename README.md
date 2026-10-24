# HCM Lite

An AI-assisted Human Capital Management system for **Admin, HR and Employees**. It starts **empty** — every number in every dashboard and every AI answer comes from something a user did in the app. One source of truth, enforced on the server, explained by AI.

## Stack (frozen)

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS** — one repo, one deploy target (Vercel), no Docker
- **API**: Next.js Route Handlers (`app/api/**`) with Zod validation, JWT (HS256, 8h) and server-side RBAC + scope guards
- **Storage**: JSON file repository (`lib/db.ts`) with atomic writes — starts empty, survives restarts. Location: `DATA_DIR` (default `./data`)
- **Auth**: bcryptjs (cost 10), httpOnly session cookie + Bearer token support
- **AI**: Google Gemini 1.5 Flash (`@google/generative-ai`) with tool calling — key lives in server env only
- **UI**: react-hot-toast, lucide-react, Recharts

## Run locally (under 10 minutes)

```bash
npm install
cp .env.example .env        # set JWT_SECRET; add GEMINI_API_KEY to enable AI (optional)
npm run build && npm start  # or: npm run dev
```

Open http://localhost:3000 — a fresh install redirects to **/setup**:

1. **Setup wizard** (one time only): company name + Admin account. Default leave types (Annual 14, Sick 8, Casual 10, Unpaid unlimited) are seeded automatically; defaults: office 09:00, grace 15 min, half day < 5h, weekend Sat–Sun.
2. **Admin** signs in → creates a department/designation in *Settings* → creates an **HR login** in *Users* (temp password shown once).
3. **HR** signs in (changes temp password) → registers **Employees** (creates login + salary structure in one transaction; temp password shown once) or imports a CSV (dry run → commit, all-or-nothing).
4. **Employee** signs in (changes temp password) → checks in/out → applies for leave (plain text or form) → downloads payslips after payroll is finalized.

## AI key setup

Set `GEMINI_API_KEY` (or `AI_API_KEY`) in the environment and restart. Without a key the AI panel replies with a friendly fallback message and every other feature works normally. Rate limit: 20 requests/user/hour (429). Timeout: 15s. Every call is logged to `ai_logs` and labelled **"AI-generated"**.

The AI has exactly **7 tools**, all executed server-side with the caller's scope: `get_headcount`, `get_attendance_summary`, `get_late_comers`, `get_leave_summary`, `get_my_leave_balance`, `get_payroll_summary`, `search_employees`. An Employee asking for a colleague's salary is refused **in code** (tool scope) and in the system prompt.

## Business rules (enforced in `lib/services/`)

- **Attendance status precedence**: `on_leave` > `holiday/weekend` > `absent` > `missing_checkout` > `half_day` > `late` > `present`. Late = check-in after 09:15 (start + grace). Half day = worked < 5h. Second check-in → 409. Server stamps all times (UTC instants, day computed in company timezone `TZ_NAME`, default `Asia/Karachi`).
- **Leave**: working days skip weekends + holidays. Overlap → 422 `LEAVE_OVERLAP`; exceeding balance → 422 `INSUFFICIENT_BALANCE`. Unpaid has no quota. Past-dated only for sick. Reject requires a comment. Approval revalidates balance + overlap at decision time. Leave spanning two years splits quota consumption per year.
- **Payroll**: `gross = 1.5 × basic` (HRA 40%, medical 10%). `perDay = gross ÷ working days of month`. Deductions = `absent + unpaid + 0.5 × half` days × per-day. Joiners/leavers prorated by employed working days. Tax: progressive annual slab on the month's gross (`gross × 12`), monthly = annual ÷ 12. Net = base − deduction − tax. Money stored as **integer paisa**; rounding half-up once per line.
  - Worked example (verified by test): basic 100,000 → gross 150,000; 22 working days; 1 absent + 1 unpaid + 2 half days → **net = 119,545.45 PKR**.
  - Tax boundaries: 600,000→0 · 600,001→0.05 · 1,200,000→30,000 · 2,400,000→210,000 · 3,600,000→510,000 (annual PKR).
- **Immutable payroll**: finalized runs reject every mutation with **409 `PAYROLL_LOCKED`**. Payslips are produced by printing `/payslips/{id}` (browser Print → Save as PDF) **from stored finalized figures** — never recomputed.
- **Audit**: append-only (`audit_logs`). Every create/update/approve/reject/finalize/deactivate/reset writes actor, action, entity, before/after JSON. There are **no update or delete routes** for audit anywhere.
- **RBAC**: `requireActor({ roles })` on every route; Employee queries are forced to `employeeId == actor.employeeId` in the API layer (`scopeEmployeeId`).

## API surface (all JSON, `{ data }` / `{ error: { code, message } }`)

| Area | Endpoints |
|---|---|
| Setup / Auth | `GET /api/setup` (status), `POST /api/setup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/logout` |
| Org | `GET/PUT /api/settings`, `GET/POST/PATCH /api/departments` (+designations), `GET/POST/PATCH /api/leave-types`, `GET/POST/DELETE /api/holidays` |
| Users | `GET/POST/PATCH /api/users` (HR logins; deactivate/activate/reset) |
| Employees | `GET/POST/PATCH/PUT /api/employees`, `GET /api/employees/360`, `POST /api/employees/import?dryRun=`, `GET /api/employees/export`, `PUT /api/salary` |
| Attendance | `GET /api/attendance/today`, `POST /api/attendance/check-in`, `POST /api/attendance/check-out`, `GET /api/attendance/me`, `GET /api/attendance/board`, `GET/POST/PUT /api/attendance/corrections` |
| Leave | `GET/POST /api/leave`, `GET /api/leave/balance`, `POST /api/leave/decision`, `POST /api/leave/cancel` |
| Payroll | `GET/POST /api/payroll/runs`, `GET /api/payroll/runs/detail`, `POST /api/payroll/runs/finalize`, `GET/POST /api/payslips` |
| Dashboards | `GET /api/dashboard/admin`, `GET /api/dashboard/hr`, `GET /api/dashboard/me` |
| Comms / Audit | `GET/POST /api/announcements`, `GET/POST /api/notifications`, `GET /api/audit` |
| AI | `POST /api/ai/chat`, `POST /api/ai/dashboard-summary`, `POST /api/ai/smart-leave` |

## 25 functionalities — done

| # | Functionality | Where |
|---|---|---|
| 01 | First-run setup (works once, 409 after) | `/setup` · `POST /api/setup` |
| 02 | Login / forced password change / logout | `/login`, `/change-password` · `/api/auth/*` |
| 03 | Company settings (hours, grace, weekend, location, radius) | `/settings` (Admin) |
| 04 | Departments, designations, leave types & quotas, holidays | `/settings` tabs |
| 05 | Create/deactivate/reset HR logins | `/users` |
| 06 | Register/edit employee (creates login + salary, temp password once) | `/employees` |
| 07 | Directory, search, Employee 360 | `/employees` (+360 modal) |
| 08 | CSV import (dry run) / export | `/employees` → Import CSV |
| 09 | Check in / out (web, server time, 409 duplicate) | Employee dashboard widget |
| 10 | Attendance calendar & daily board | `/attendance` |
| 11 | Attendance corrections (request → approve/reject) | `/corrections` |
| 12 | Apply/cancel leave, balance, history | `/leave` |
| 13 | Approve/reject leave with comment | `/leave` (HR/Admin inbox) |
| 14 | Salary structure (HRA/medical/gross derived, history) | `/employees` → Wallet icon · `PUT /api/salary` |
| 15 | Monthly payroll draft (create/regenerate) | `/payroll` |
| 16 | Finalize payroll (Admin, locks → 409) | `/payroll` |
| 17 | Payslips + print/PDF | `/payslips`, `/payslips/{id}` |
| 18 | Dashboards/KPIs per role with filters | `/dashboard` (3 role views, Recharts) |
| 19 | AI chat with 7 scoped tools + refusal | AI drawer (all roles) |
| 20 | AI dashboard summary (3–5 bullets, number-checked) | Summarize button (Admin/HR) |
| 21 | Smart leave (sentence → pre-filled editable form) | `/leave` → Smart leave box |
| 22 | Policy Q&A (rules in system prompt, "I don't know" fallback) | AI drawer |
| 23 | Announcements (Admin/HR post, all read) | `/announcements` |
| 24 | Notifications (leave/correction/payslip/reset/announcement) | Bell in header |
| 25 | Audit log (append-only, Admin only) | `/audit` |

**Not done (cut line, bonus only):** camera/geofence attendance, attrition risk score, absence anomaly flags, late-penalty rule (3 lates = 0.5 day), Roman Urdu prompts, dark mode/PWA. The geofence fields (lat/lng/radius) exist in settings but are not enforced at check-in (core attendance is time-based per spec FR-M4-01).

## Rulings & assumptions

1. Timezone default `Asia/Karachi` (configurable via `TZ_NAME`).
2. Tax computed on the month's gross (full-month `1.5 × basic`; prorated `base` for joiners/leavers), never on the post-deduction amount; monthly tax = annual ÷ 12.
3. CSV import is all-or-nothing after a clean dry run.
4. Past-dated leave allowed only for sick; others must start today or later.
5. Payslips visible to employees only after the run is finalized.
6. "Next Monday" = first Monday strictly after today (resolved server-side).
7. HR and Employee users each have an `employee` record when registered; Admin does not check in.
8. Employee status `probation` counts in headcount.
9. Logout is client-side token discard + httpOnly cookie clear.
10. Payslip "PDF" = print-optimized page (browser Save as PDF) generated from stored finalized figures.
11. For the current month, payroll counts attendance of finished days only (future days are neither absent nor paid); approved unpaid-leave days count once as unpaid, never as absent.
12. Money is stored as integer paisa; rounding half-up once per payslip line, so the tax boundary values (e.g. 600,001 → 0.05) hold exactly.

## Data & reset

All data lives in `DATA_DIR/hcm.json` (default `./data/hcm.json`). The system starts empty; the only automatic seeds are the four default leave types created by first-run setup (per FR-M2-05 — seeding logic, not demo data). To re-run the judge flow from scratch: stop the server, delete the `data/` folder, start again.

## 5-minute demo script

1. **Fresh install** → Admin runs the setup wizard → opens *Settings*, adds a department → opens *Users*, creates an HR login (temp password shown once).
2. **HR** signs in with the temp password → forced password change → registers 2 employees in *Employees* (each gets a one-time temp password).
3. **Employee** signs in → changes temp password → checks in on the dashboard.
4. **Employee** opens *Leave* → types "Need next Monday and Tuesday off for my sister's wedding" → the AI pre-fills the form (AI-suggested badge) → submits → **HR** approves with a comment in the leave inbox.
5. **HR** opens *Dashboard* → clicks **Summarize** → opens the AI drawer and asks "who is on leave today?" → runs payroll in *Payroll* → **Admin** hits **Finalize & lock**.
6. **Employee** opens *Payslips* → opens the payslip → Print/Save as PDF → asks the AI for a colleague's salary (**politely refused**) → **Admin** opens *Audit log* and shows the trail.
