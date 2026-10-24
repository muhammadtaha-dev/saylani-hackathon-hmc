"use client";

// Payslips: employees see own (finalized only); HR/Admin see all.
import React, { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { api, ApiClientError, qs } from "@/lib/client";
import { Badge, Card, Empty, ErrorState, Loading, PageHeader, Table } from "@/lib/ui";
import { fmtPKR, monthName } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Slip {
  id: string; month: number; year: number; employeeId: string; employeeName: string;
  employeeCode: string | null; status: string; gross: number; deductions: number; tax: number; net: number;
}

export default function PayslipsPage() {
  const { user } = useSession();
  const [rows, setRows] = useState<Slip[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ payslips: Slip[] }>(`/api/payslips${qs({ month, year })}`);
      setRows(res.payslips);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load payslips.");
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    load();
  }, [load]);

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="Payslips"
        subtitle={user.role === "employee" ? "Finalized payslips for you. Open one to print or save as PDF." : "All payslips. Employees see theirs only after the run is finalized."}
        actions={
          <div className="flex gap-2">
            <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm">
              <option value="">All months</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
            </select>
            <input type="number" value={year} onChange={(e) => setYear(e.target.value)} className="w-24 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm" placeholder={String(now.getFullYear())} />
          </div>
        }
      />
      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows || rows.length === 0 ? (
          <Empty title="No payslips found" hint="Payslips appear after HR runs payroll and Admin finalizes it." />
        ) : (
          <Table head={["Period", ...(user.role !== "employee" ? ["Employee"] : []), "Gross", "Deductions", "Tax", "Net", "Status", ""]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-2.5 font-medium text-slate-800">{monthName(p.month)} {p.year}</td>
                {user.role !== "employee" && (
                  <td className="px-4 py-2.5 text-slate-600">{p.employeeName} <span className="font-mono text-xs text-slate-400">{p.employeeCode}</span></td>
                )}
                <td className="px-4 py-2.5 text-slate-600">{fmtPKR(p.gross)}</td>
                <td className="px-4 py-2.5 text-red-500">−{fmtPKR(p.deductions)}</td>
                <td className="px-4 py-2.5 text-red-500">−{fmtPKR(p.tax)}</td>
                <td className="px-4 py-2.5 font-semibold text-slate-900">{fmtPKR(p.net)}</td>
                <td className="px-4 py-2.5"><Badge value={p.status} /></td>
                <td className="px-4 py-2.5 text-right">
                  <a href={`/payslips/${p.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline">
                    <FileText className="h-3.5 w-3.5" /> open
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
