"use client";

// Payroll: HR creates/reviews drafts; Admin views + Finalize (locks forever).
import React, { useCallback, useEffect, useState } from "react";
import { Lock, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError, qs } from "@/lib/client";
import { Badge, Button, Card, CardHeader, ConfirmDialog, Empty, ErrorState, KPI, Loading, PageHeader, Table } from "@/lib/ui";
import { fmtPKR, fmtPKRShort, monthName } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Run { id: string; month: number; year: number; status: string; finalizedAt: string | null; totals: { gross: number; deductions: number; tax: number; net: number }; createdAt: string }
interface Line {
  id: string; employeeId: string; employeeName: string; employeeCode: string | null; department: string | null;
  workingDays: number; employedDays: number; daysPaid: number;
  basic: number; hra: number; medical: number; gross: number;
  deductions: number; tax: number; net: number;
  deductionsJson: { absentDays: number; unpaidDays: number; halfDays: number; deductionDays: number };
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function PayrollPage() {
  const { user } = useSession();
  const isAdmin = user?.role === "admin";
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [detail, setDetail] = useState<{ run: Run; lines: Line[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState<Run | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ runs: Run[] }>("/api/payroll/runs");
      setRuns(r.runs);
      const existing = r.runs.find((x) => x.month === month && x.year === year);
      if (existing) {
        setDetail(await api.get<{ run: Run; lines: Line[] }>(`/api/payroll/runs/detail${qs({ id: existing.id })}`));
      } else {
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load payroll.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    load();
  }, [load]);

  const createOrRegenerate = async () => {
    setBusy(true);
    try {
      await api.post("/api/payroll/runs", { month, year });
      toast.success("Draft payroll generated");
      await load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Could not generate payroll.");
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!confirmFinalize) return;
    setBusy(true);
    try {
      await api.post(`/api/payroll/runs/finalize${qs({ id: confirmFinalize.id })}`);
      toast.success("Payroll finalized and locked");
      setConfirmFinalize(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Finalize failed.");
    } finally {
      setBusy(false);
    }
  };

  const run = detail?.run;
  const locked = run?.status === "finalized";

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle={isAdmin ? "Review the draft, then Finalize to lock payslips forever." : "Create and review the monthly draft. Only Admin can finalize."}
        actions={
          <div className="flex items-center gap-2">
            <select value={month} onChange={(e) => setMonth(parseInt(e.target.value, 10))} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
            </select>
            <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(parseInt(e.target.value, 10) || year)} className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" />
            <Button small onClick={createOrRegenerate} loading={busy} disabled={locked}>
              <RefreshCw className="h-3.5 w-3.5" /> {run ? "Regenerate draft" : "Create draft"}
            </Button>
            {isAdmin && run && !locked && (
              <Button small variant="danger" onClick={() => setConfirmFinalize(run)}>
                <Lock className="h-3.5 w-3.5" /> Finalize & lock
              </Button>
            )}
          </div>
        }
      />

      {run && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <KPI label="Status" value={<Badge value={run.status} />} hint={run.finalizedAt ? `finalized ${new Date(run.finalizedAt).toLocaleString()}` : "draft — still editable"} />
          <KPI label="Employees" value={detail?.lines.length ?? 0} />
          <KPI label="Gross" value={fmtPKRShort(run.totals.gross)} />
          <KPI label="Deductions + Tax" value={fmtPKRShort(run.totals.deductions + run.totals.tax)} />
          <KPI label="Net payable" value={fmtPKRShort(run.totals.net)} tone="good" />
        </div>
      )}

      {locked && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          🔒 This run is <strong>finalized</strong>. Payslips are frozen; any further mutation is rejected with 409 PAYROLL_LOCKED.
        </div>
      )}

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !run ? (
          <Empty
            title={`No payroll run for ${monthName(month)} ${year}`}
            hint="Create a draft to compute gross, deductions, tax and net per employee from attendance and leave data."
            action={<Button small onClick={createOrRegenerate} loading={busy}>Create draft</Button>}
          />
        ) : detail && detail.lines.length === 0 ? (
          <Empty title="No payslip lines" hint="Employees must have a salary structure to be included." />
        ) : detail ? (
          <Table head={["Code", "Employee", "Dept", "Paid", "Basic", "Gross", "Deductions", "Tax", "Net", ""]}>
            {detail.lines.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{l.employeeCode}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{l.employeeName}</td>
                <td className="px-4 py-2.5 text-slate-600">{l.department ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {l.daysPaid}/{l.workingDays}d
                  <span className="block text-[10px] text-slate-400">
                    A{l.deductionsJson.absentDays} · U{l.deductionsJson.unpaidDays} · H{l.deductionsJson.halfDays}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-slate-600">{fmtPKRShort(l.basic)}</td>
                <td className="px-4 py-2.5 text-slate-600">{fmtPKRShort(l.gross)}</td>
                <td className="px-4 py-2.5 text-red-500">−{fmtPKRShort(l.deductions)}</td>
                <td className="px-4 py-2.5 text-red-500">−{fmtPKRShort(l.tax)}</td>
                <td className="px-4 py-2.5 font-semibold text-slate-900">{fmtPKR(l.net)}</td>
                <td className="px-4 py-2.5 text-right">
                  <a href={`/payslips/${l.id}`} className="text-xs font-medium text-slate-500 underline">payslip</a>
                </td>
              </tr>
            ))}
          </Table>
        ) : null}
      </Card>

      {runs && runs.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Run history" />
          <div className="divide-y divide-slate-100">
            {runs.map((r) => (
              <button key={r.id} onClick={() => { setMonth(r.month); setYear(r.year); }} className="flex w-full items-center justify-between px-5 py-2.5 text-left text-sm hover:bg-slate-50">
                <span className="text-slate-700">{monthName(r.month)} {r.year}</span>
                <span className="flex items-center gap-3">
                  <span className="text-slate-500">net {fmtPKR(r.totals.net)}</span>
                  <Badge value={r.status} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!confirmFinalize}
        onClose={() => setConfirmFinalize(null)}
        onConfirm={finalize}
        title="Finalize payroll"
        message={`Finalize ${monthName(month)} ${year} for ${detail?.lines.length ?? 0} employees (net ${fmtPKR(run?.totals.net ?? 0)})? Payslips freeze permanently and cannot be edited.`}
        confirmLabel="Finalize & lock"
        danger
        loading={busy}
      />
    </div>
  );
}
