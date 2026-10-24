"use client";

// Audit log: Admin-only, append-only. No update/delete endpoints exist.
import React, { useCallback, useEffect, useState } from "react";
import { qs } from "@/lib/client";
import { Card, Empty, ErrorState, Loading, PageHeader, Select, Table } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface AuditRow {
  id: string; at: string; actorEmail: string; actorRole: string;
  action: string; entity: string; entityId: string | null;
  before: unknown; after: unknown;
}

function pretty(v: unknown): string {
  if (v === null || v === undefined) return "—";
  try {
    return JSON.stringify(v, null, 1);
  } catch {
    return String(v);
  }
}

export default function AuditPage() {
  const { user } = useSession();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit${qs({ action, entity, page, limit: 20 })}`, { credentials: "include" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message || "Failed to load audit log.");
      setRows(j.data);
      setTotal(j.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  }, [action, entity, page]);

  useEffect(() => {
    if (user?.role === "admin") load();
    else setLoading(false);
  }, [load, user]);

  if (user && user.role !== "admin") {
    return <Empty title="Admins only" hint="The audit log is restricted to Admin." />;
  }

  const actions = ["create", "update", "approve", "reject", "finalize", "deactivate", "activate", "reset_password", "cancel", "check_in", "check_out", "salary_change", "login", "password_change", "import", "delete", "setup", "seed"];

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle={`${total} entr(ies) · append-only — every important action with before/after. There are no update or delete routes.`}
      />
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap gap-2">
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="!w-44">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }} className="!w-44">
            <option value="">All entities</option>
            {["company", "settings", "user", "department", "designation", "leave_type", "holiday", "employee", "salary_structure", "attendance", "attendance_correction", "leave_request", "payroll_run", "announcement", "audit"].map((x) => <option key={x} value={x}>{x}</option>)}
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows || rows.length === 0 ? (
          <Empty title="No audit entries" hint="Actions like creating employees, approving leave and finalizing payroll appear here." />
        ) : (
          <>
            <Table head={["When", "Actor", "Action", "Entity", ""]}>
              {rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{fmtDateTime(r.at)}</td>
                    <td className="px-4 py-2.5 text-slate-700">{r.actorEmail} <span className="text-xs text-slate-400">({r.actorRole})</span></td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.action}</td>
                    <td className="px-4 py-2.5 text-slate-600">{r.entity}{r.entityId ? <span className="ml-1 font-mono text-[10px] text-slate-400">{r.entityId.slice(0, 8)}</span> : null}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-slate-400">{expanded === r.id ? "hide" : "before / after"}</td>
                  </tr>
                  {expanded === r.id && (
                    <tr className="bg-slate-50">
                      <td colSpan={5} className="px-6 py-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase text-slate-400">Before</p>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-[11px] text-slate-600 ring-1 ring-slate-200">{pretty(r.before)}</pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold uppercase text-slate-400">After</p>
                            <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-[11px] text-slate-600 ring-1 ring-slate-200">{pretty(r.after)}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </Table>
            {total > 20 && (
              <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500">
                <span>Page {page} of {Math.ceil(total / 20)}</span>
                <div className="flex gap-2">
                  <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <button className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs disabled:opacity-40" disabled={page >= Math.ceil(total / 20)} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
