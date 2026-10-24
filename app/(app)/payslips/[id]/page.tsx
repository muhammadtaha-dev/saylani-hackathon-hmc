"use client";

// Printable payslip generated from STORED finalized figures (never recomputed).
// Print -> "Save as PDF" produces the downloadable PDF.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Printer } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { Button, ErrorState, Loading } from "@/lib/ui";
import { fmtPKR, monthName } from "@/lib/format";
import { useSession } from "@/lib/session";

interface PayslipDetail {
  payslip: {
    id: string; month: number; year: number; workingDays: number; employedDays: number; daysPaid: number;
    basic: number; hra: number; medical: number; gross: number;
    deductionDays: number; deductions: number; tax: number; net: number;
    deductionsJson: { absentDays: number; unpaidDays: number; halfDays: number; deductionDays: number };
  };
  employee: { name: string; code: string; designation: string | null; joinDate: string } | null;
  department: string | null;
  company: { name: string } | null;
  run: { status: string; finalizedAt: string | null } | null;
}

export default function PayslipPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useSession();
  const [data, setData] = useState<PayslipDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post<PayslipDetail>("/api/payslips", { id: params.id });
      setData(res);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load payslip.");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} />;
  if (!data) return null;

  const p = data.payslip;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button variant="secondary" small onClick={() => router.back()}>
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </Button>
        <Button small onClick={() => window.print()}>
          <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
        </Button>
      </div>

      <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:max-w-none print:shadow-none">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{data.company?.name ?? "Company"}</h1>
            <p className="text-xs text-slate-500">Payslip · {monthName(p.month)} {p.year}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wide text-slate-400">Net pay</p>
            <p className="text-2xl font-bold text-slate-900">{fmtPKR(p.net)}</p>
            {data.run?.status === "finalized" ? (
              <p className="text-[10px] text-emerald-600">Finalized {data.run.finalizedAt ? new Date(data.run.finalizedAt).toLocaleDateString() : ""}</p>
            ) : (
              <p className="text-[10px] text-amber-600">Draft</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 py-4 text-sm">
          {[
            ["Employee", data.employee?.name ?? "—"],
            ["Employee code", data.employee?.code ?? "—"],
            ["Department", data.department ?? "—"],
            ["Designation", data.employee?.designation ?? "—"],
            ["Join date", data.employee?.joinDate ?? "—"],
            ["Working days", `${p.workingDays}`],
            ["Days paid", `${p.daysPaid}`],
            ["Deduction days", `${p.deductionDays} (A ${p.deductionsJson.absentDays} · U ${p.deductionsJson.unpaidDays} · H ${p.deductionsJson.halfDays}×0.5)`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4">
              <span className="text-slate-500">{k}</span>
              <span className="font-medium text-slate-800">{v}</span>
            </div>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase text-slate-500">
              <th className="px-3 py-2">Earnings</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Deductions</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="px-3 py-2 text-slate-700">Basic</td>
              <td className="px-3 py-2 text-right text-slate-800">{fmtPKR(p.basic)}</td>
              <td className="px-3 py-2 text-slate-700">Attendance & unpaid leave</td>
              <td className="px-3 py-2 text-right text-red-600">−{fmtPKR(p.deductions)}</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-slate-700">House rent allowance (40%)</td>
              <td className="px-3 py-2 text-right text-slate-800">{fmtPKR(p.hra)}</td>
              <td className="px-3 py-2 text-slate-700">Income tax (monthly)</td>
              <td className="px-3 py-2 text-right text-red-600">−{fmtPKR(p.tax)}</td>
            </tr>
            <tr>
              <td className="px-3 py-2 text-slate-700">Medical allowance (10%)</td>
              <td className="px-3 py-2 text-right text-slate-800">{fmtPKR(p.medical)}</td>
              <td />
              <td />
            </tr>
            <tr className="border-t border-slate-200 font-semibold">
              <td className="px-3 py-2 text-slate-900">Gross</td>
              <td className="px-3 py-2 text-right text-slate-900">{fmtPKR(p.gross)}</td>
              <td className="px-3 py-2 text-slate-900">Total deductions</td>
              <td className="px-3 py-2 text-right text-red-700">{fmtPKR(p.deductions + p.tax)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-900 px-4 py-3 text-white">
          <span className="text-sm font-medium">Net pay</span>
          <span className="text-lg font-bold">{fmtPKR(p.net)}</span>
        </div>

        <p className="mt-4 text-[10px] text-slate-400">
          This is a system-generated payslip from finalized payroll figures. Tax applies the progressive annual slab on gross × 12, divided by 12. Generated by HCM Lite.
        </p>
      </div>
      {user?.role === "employee" && <span className="hidden">{user.role}</span>}
    </div>
  );
}
