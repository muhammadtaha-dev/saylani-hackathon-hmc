"use client";

// Employee directory + registration + 360 + CSV import/export.
// Employees see only themselves (server-enforced; UI mirrors it).
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, Plus, Upload, Eye, Pencil, Wallet, KeyRound } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError, qs } from "@/lib/client";
import { Badge, Button, Card, Empty, ErrorState, Input, Loading, Modal, PageHeader, Select, Table } from "@/lib/ui";
import { fmtPKR } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Row {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  gender: string | null;
  joinDate: string;
  status: string;
  departmentId: string | null;
  departmentName: string | null;
  designationId: string | null;
  designationTitle: string | null;
  userActive: boolean;
}
interface ListRes {
  data: Row[];
  page: number;
  limit: number;
  total: number;
}
interface Dept { departments: Array<{ id: string; name: string; isActive: boolean }>; designations: Array<{ id: string; title: string; departmentId: string | null; isActive: boolean }> }

interface Profile360 {
  profile: Row & { address: string | null; dob: string | null; exitDate: string | null };
  department: { name: string } | null;
  designation: { title: string } | null;
  manager: { name: string } | null;
  salary: { basicPaisa: number; hraPaisa: number; medicalPaisa: number; grossPaisa: number; effectiveFrom: string } | null;
  attendanceSummary: { from: string; to: string; present: number; late: number; half: number; absent: number; onLeave: number; nonWorking: number; missing: number };
  leaveBalances: Array<{ name: string; quota: number | null; approved: number; pending: number; remaining: number | null }>;
  latestPayslip: { id: string; month: number; year: number; netPaisa: number; finalized: boolean } | null;
}

const emptyForm = {
  code: "", firstName: "", lastName: "", email: "", phone: "", gender: "", dob: "", joinDate: "",
  departmentId: "", designationId: "", basic: "", status: "probation",
};

export default function EmployeesPage() {
  const { user } = useSession();
  const isHRorAdmin = user?.role === "admin" || user?.role === "hr";

  const [list, setList] = useState<ListRes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [masters, setMasters] = useState<Dept | null>(null);

  const [registerOpen, setRegisterOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);

  const [editRow, setEditRow] = useState<Row | null>(null);
  const [salaryRow, setSalaryRow] = useState<Row | null>(null);
  const [salaryBasic, setSalaryBasic] = useState("");
  const [view360, setView360] = useState<Profile360 | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [dryResult, setDryResult] = useState<{ validRows: number; errors: Array<{ row: number; field: string; reason: string }>; committed?: boolean } | null>(null);
  const [csvText, setCsvText] = useState("");
  const [tempPasswords, setTempPasswords] = useState<Array<{ code: string; email: string; tempPassword: string }> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ListRes>(`/api/employees${qs({ search, departmentId, status, page, limit: 10 })}`);
      setList(res);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load employees.");
    } finally {
      setLoading(false);
    }
  }, [search, departmentId, status, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (isHRorAdmin) {
      api.get<Dept>("/api/departments").then(setMasters).catch(() => {});
    }
  }, [isHRorAdmin]);

  const register = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ employee: Row; tempPassword: string }>("/api/employees", {
        ...form,
        phone: form.phone || null,
        gender: form.gender || null,
        dob: form.dob || null,
        departmentId: form.departmentId || null,
        designationId: form.designationId || null,
        basic: parseFloat(form.basic),
      });
      setRegisterOpen(false);
      setTempPassword({ email: res.employee.email, password: res.tempPassword });
      setForm(emptyForm);
      load();
    } catch (e) {
      if (e instanceof ApiClientError && e.details?.length) {
        toast.error(`${e.details[0].field}: ${e.details[0].reason}`);
      } else {
        toast.error(e instanceof ApiClientError ? e.message : "Registration failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!editRow) return;
    setBusy(true);
    try {
      await api.patch(`/api/employees${qs({ id: editRow.id })}`, {
        firstName: editRow.firstName,
        lastName: editRow.lastName,
        email: editRow.email,
        phone: editRow.phone,
        gender: editRow.gender,
        joinDate: editRow.joinDate,
        departmentId: editRow.departmentId,
        designationId: editRow.designationId,
        status: editRow.status,
      });
      toast.success("Employee updated");
      setEditRow(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  };

  const saveSalary = async () => {
    if (!salaryRow) return;
    setBusy(true);
    try {
      const res = await api.put<{ salary: { gross: number } }>(`/api/salary${qs({ employeeId: salaryRow.id })}`, { basic: parseFloat(salaryBasic) });
      toast.success(`Salary saved — gross ${fmtPKR(res.salary.gross)}`);
      setSalaryRow(null);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Salary update failed.");
    } finally {
      setBusy(false);
    }
  };

  const open360 = async (id: string) => {
    try {
      setView360(await api.get<Profile360>(`/api/employees/360${qs({ id })}`));
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Could not load profile.");
    }
  };

  const onCsvFile = (f: File | undefined) => {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ""));
    reader.readAsText(f);
  };

  const runDry = async () => {
    if (!csvText.trim()) {
      toast.error("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    try {
      const res = await api.raw.post(`/api/employees/import?dryRun=true`, csvText, "text/csv") as unknown as { validRows: number; errors: Array<{ row: number; field: string; reason: string }> };
      setDryResult(res);
      setTempPasswords(null);
    } catch (e) {
      const err = e as ApiClientError;
      if (err.details && Array.isArray(err.details)) setDryResult({ validRows: 0, errors: err.details as Array<{ row: number; field: string; reason: string }> });
      else toast.error(err.message || "Dry run failed.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const res = await api.raw.post(`/api/employees/import?dryRun=false`, csvText, "text/csv") as unknown as { tempPasswords: Array<{ code: string; email: string; tempPassword: string }> };
      setTempPasswords(res.tempPasswords ?? null);
      setDryResult(null);
      toast.success("Employees imported");
      load();
    } catch (e) {
      const err = e as ApiClientError;
      if (err.details && Array.isArray(err.details)) setDryResult({ validRows: 0, errors: err.details as Array<{ row: number; field: string; reason: string }> });
      else toast.error(err.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const url = `/api/employees/export${qs({ search, departmentId, status })}`;
    window.open(url, "_blank");
  };

  if (!user) return null;
  if (user.role === "employee") {
    // Employees see only themselves via the API; render a simple self view.
    return (
      <div>
        <PageHeader title="My profile" />
        {list?.data?.[0] && (
          <Card className="p-5 text-sm text-slate-700">
            <p className="text-base font-semibold">{list.data[0].firstName} {list.data[0].lastName} <span className="text-slate-400">({list.data[0].code})</span></p>
            <p className="mt-1">{list.data[0].email}</p>
            <p className="text-slate-500">{list.data[0].designationTitle ?? ""} {list.data[0].departmentName ? `· ${list.data[0].departmentName}` : ""}</p>
            <Button className="mt-4" variant="secondary" small onClick={() => open360(list.data[0].id)}>
              <Eye className="h-3.5 w-3.5" /> View my 360
            </Button>
          </Card>
        )}
        {loading && <Loading />}
        <Modal open={!!view360} onClose={() => setView360(null)} title="Employee 360" wide>
          {view360 && <Profile360View data={view360} showSalary={false} />}
        </Modal>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${list?.total ?? 0} employee(s)`}
        actions={
          isHRorAdmin && (
            <>
              <Button variant="secondary" small onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export CSV</Button>
              {user.role === "hr" && (
                <Button variant="secondary" small onClick={() => { setImportOpen(true); setDryResult(null); setTempPasswords(null); }}>
                  <Upload className="h-3.5 w-3.5" /> Import CSV
                </Button>
              )}
              {user.role === "hr" && (
                <Button small onClick={() => { setRegisterOpen(true); setForm(emptyForm); }}>
                  <Plus className="h-3.5 w-3.5" /> Register employee
                </Button>
              )}
            </>
          )
        }
      />

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <Input placeholder="Search name, code, email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="!w-64" />
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }} className="!w-48">
            <option value="">All departments</option>
            {masters?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="!w-40">
            <option value="">Any status</option>
            <option value="probation">Probation</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="exited">Exited</option>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !list || list.data.length === 0 ? (
          <Empty
            title="No employees found"
            hint={isHRorAdmin ? "Register your first employee to get started." : undefined}
            action={user.role === "hr" ? <Button small onClick={() => setRegisterOpen(true)}><Plus className="h-3.5 w-3.5" /> Register employee</Button> : undefined}
          />
        ) : (
          <Table head={["Code", "Name", "Department", "Designation", "Status", "Joined", ""]}>
            {list.data.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{r.code}</td>
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-800">{r.firstName} {r.lastName}</p>
                  <p className="text-xs text-slate-400">{r.email}</p>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{r.departmentName ?? "—"}</td>
                <td className="px-4 py-2.5 text-slate-600">{r.designationTitle ?? "—"}</td>
                <td className="px-4 py-2.5"><Badge value={r.status} /></td>
                <td className="px-4 py-2.5 text-slate-500">{r.joinDate}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" small onClick={() => open360(r.id)}><Eye className="h-3.5 w-3.5" /> 360</Button>
                    {user.role === "hr" && (
                      <>
                        <Button variant="ghost" small onClick={() => setEditRow(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" small onClick={() => { setSalaryRow(r); setSalaryBasic(""); }}><Wallet className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
        {list && list.total > list.limit && (
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500">
            <span>Page {list.page} of {Math.ceil(list.total / list.limit)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" small disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" small disabled={page >= Math.ceil(list.total / list.limit)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {/* Register modal */}
      <Modal open={registerOpen} onClose={() => setRegisterOpen(false)} title="Register employee" wide>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Employee code *" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="EMP-001" />
          <Input label="Email *" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ali@company.com" />
          <Input label="First name *" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input label="Last name *" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label="Gender" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </Select>
          <Input label="Date of birth" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} />
          <Input label="Join date *" type="date" required value={form.joinDate} onChange={(e) => setForm({ ...form, joinDate: e.target.value })} />
          <Select label="Department" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">— Select —</option>
            {masters?.departments.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select label="Designation" value={form.designationId} onChange={(e) => setForm({ ...form, designationId: e.target.value })}>
            <option value="">— Select —</option>
            {masters?.designations.filter((d) => d.isActive).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </Select>
          <Input label="Basic salary (PKR / month) *" type="number" min="1" value={form.basic} onChange={(e) => setForm({ ...form, basic: e.target.value })} placeholder="100000" />
          <Select label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="probation">Probation</option>
            <option value="active">Active</option>
          </Select>
        </div>
        <p className="mt-3 text-xs text-slate-400">Gross is derived as 1.5 × basic (HRA 40% + medical 10%). A login with a temporary password is created automatically.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRegisterOpen(false)}>Cancel</Button>
          <Button onClick={register} loading={busy}>Create employee</Button>
        </div>
      </Modal>

      {/* Temp password shown ONCE */}
      <Modal open={!!tempPassword} onClose={() => setTempPassword(null)} title="Employee created — temporary password">
        {tempPassword && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">Share this temporary password with <strong>{tempPassword.email}</strong>. It is shown <strong>only once</strong>.</p>
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 font-mono text-lg font-bold text-amber-700">
              <KeyRound className="h-5 w-5" /> {tempPassword.password}
            </div>
            <p className="text-xs text-slate-400">The employee must change it at first sign-in.</p>
            <div className="flex justify-end">
              <Button onClick={() => setTempPassword(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editRow} onClose={() => setEditRow(null)} title={`Edit ${editRow?.firstName ?? ""} ${editRow?.lastName ?? ""}`} wide>
        {editRow && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Input label="First name" value={editRow.firstName} onChange={(e) => setEditRow({ ...editRow, firstName: e.target.value })} />
              <Input label="Last name" value={editRow.lastName} onChange={(e) => setEditRow({ ...editRow, lastName: e.target.value })} />
              <Input label="Email" type="email" value={editRow.email} onChange={(e) => setEditRow({ ...editRow, email: e.target.value })} />
              <Input label="Phone" value={editRow.phone ?? ""} onChange={(e) => setEditRow({ ...editRow, phone: e.target.value })} />
              <Select label="Department" value={editRow.departmentId ?? ""} onChange={(e) => setEditRow({ ...editRow, departmentId: e.target.value })}>
                <option value="">— Select —</option>
                {masters?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Select label="Designation" value={editRow.designationId ?? ""} onChange={(e) => setEditRow({ ...editRow, designationId: e.target.value })}>
                <option value="">— Select —</option>
                {masters?.designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
              <Input label="Join date" type="date" value={editRow.joinDate} onChange={(e) => setEditRow({ ...editRow, joinDate: e.target.value })} />
              <Select label="Status" value={editRow.status} onChange={(e) => setEditRow({ ...editRow, status: e.target.value })}>
                <option value="probation">Probation</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="exited">Exited (deactivates login)</option>
              </Select>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditRow(null)}>Cancel</Button>
              <Button onClick={saveEdit} loading={busy}>Save changes</Button>
            </div>
          </>
        )}
      </Modal>

      {/* Salary modal */}
      <Modal open={!!salaryRow} onClose={() => setSalaryRow(null)} title={`Salary — ${salaryRow?.firstName ?? ""} ${salaryRow?.lastName ?? ""}`}>
        {salaryRow && (
          <>
            <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              HRA = 40% of basic · Medical = 10% · <strong>Gross = 1.5 × basic</strong>. History is kept with effective dates.
            </div>
            <Input label="Basic salary (PKR / month)" type="number" min="1" value={salaryBasic} onChange={(e) => setSalaryBasic(e.target.value)} placeholder="100000" />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSalaryRow(null)}>Cancel</Button>
              <Button onClick={saveSalary} loading={busy}>Save salary</Button>
            </div>
          </>
        )}
      </Modal>

      {/* CSV import wizard */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import employees from CSV" wide>
        <div className="space-y-3">
          <p className="text-xs text-slate-500">Columns: code, firstName, lastName, email, phone, department, designation, joinDate, gender, basic. Import is <strong>all-or-nothing</strong>: the commit button unlocks only when the dry run reports zero errors.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onCsvFile(e.target.files?.[0])} className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200" />
          {csvText && <p className="text-xs text-slate-400">{csvText.split("\n").filter(Boolean).length - 1} data row(s) loaded.</p>}
          <div className="flex gap-2">
            <Button variant="secondary" small onClick={runDry} loading={busy}>1. Dry run</Button>
            <Button small onClick={commit} loading={busy} disabled={!dryResult || dryResult.errors.length > 0 || dryResult.validRows === 0}>
              2. Commit import
            </Button>
          </div>
          {dryResult && (
            <div className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-100 px-3 py-2 text-xs">
                <span className="font-semibold text-emerald-600">{dryResult.validRows} valid row(s)</span>
                <span className="ml-2 font-semibold text-red-500">{dryResult.errors.length} error(s)</span>
              </div>
              {dryResult.errors.length > 0 ? (
                <Table head={["Row", "Field", "Problem"]}>
                  {dryResult.errors.map((e, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-xs">{e.row}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{e.field}</td>
                      <td className="px-3 py-1.5 text-xs text-red-600">{e.reason}</td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="px-3 py-3 text-xs text-emerald-600">All rows valid — you can commit the import now.</p>
              )}
            </div>
          )}
          {tempPasswords && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-xs font-semibold text-amber-700">Temporary passwords (shown once):</p>
              <div className="space-y-1 font-mono text-xs text-amber-800">
                {tempPasswords.map((t) => (
                  <p key={t.code}>{t.code} · {t.email} → {t.tempPassword}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 360 modal */}
      <Modal open={!!view360} onClose={() => setView360(null)} title="Employee 360" wide>
        {view360 && <Profile360View data={view360} showSalary />}
      </Modal>
    </div>
  );
}

function Profile360View({ data, showSalary }: { data: Profile360; showSalary: boolean }) {
  const p = data.profile;
  const s = data.attendanceSummary;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 p-4">
        <div>
          <p className="text-base font-semibold text-slate-900">{p.firstName} {p.lastName} <span className="font-mono text-xs text-slate-400">{p.code}</span></p>
          <p className="text-xs text-slate-500">{data.designation?.title ?? "—"} · {data.department?.name ?? "No department"} · {p.email}</p>
        </div>
        <Badge value={p.status} />
      </div>

      {showSalary && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Salary (HR/Admin only)</p>
          {data.salary ? (
            <div className="grid grid-cols-4 gap-2">
              {[
                ["Basic", data.salary.basicPaisa],
                ["HRA 40%", data.salary.hraPaisa],
                ["Medical 10%", data.salary.medicalPaisa],
                ["Gross 1.5×", data.salary.grossPaisa],
              ].map(([label, v]) => (
                <div key={String(label)} className="rounded-lg border border-slate-200 p-2.5 text-center">
                  <p className="text-[10px] uppercase text-slate-400">{label}</p>
                  <p className="text-sm font-semibold text-slate-800">{fmtPKR(v as number)}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-400">No salary structure set.</p>
          )}
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Attendance · last 30 days</p>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {[
            ["Present", s.present], ["Late", s.late], ["Half", s.half], ["Absent", s.absent],
            ["Leave", s.onLeave], ["Off", s.nonWorking], ["Missing", s.missing],
          ].map(([label, v]) => (
            <div key={String(label)} className="rounded-lg border border-slate-200 p-2 text-center">
              <p className="text-[10px] uppercase text-slate-400">{label}</p>
              <p className="text-sm font-semibold text-slate-800">{v}</p>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Leave balances (this year)</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {data.leaveBalances.map((b) => (
            <div key={b.name} className="rounded-lg border border-slate-200 p-2.5">
              <p className="text-xs font-medium text-slate-600">{b.name}</p>
              <p className="text-sm font-semibold text-slate-800">{b.remaining === null ? `${b.approved} used` : `${b.remaining} left`}</p>
              <p className="text-[10px] text-slate-400">{b.quota === null ? "unlimited" : `quota ${b.quota}`} · pending {b.pending}</p>
            </div>
          ))}
        </div>
      </div>

      {data.latestPayslip && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Latest payslip</p>
          <p className="text-sm text-slate-700">
            {data.latestPayslip.finalized ? <>Net {fmtPKR(data.latestPayslip.netPaisa)}</> : "Pending finalization"}
          </p>
        </div>
      )}
    </div>
  );
}
