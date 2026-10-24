"use client";

// Leave: smart-leave box (AI drafts, human confirms), apply form, balance
// cards, history + cancel; HR/Admin get the approval inbox.
import React, { useCallback, useEffect, useState } from "react";
import { Wand2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError, qs } from "@/lib/client";
import { AISuggestedBadge, Badge, Button, Card, CardHeader, ConfirmDialog, Empty, ErrorState, Input, Loading, PageHeader, Select, Table, Textarea } from "@/lib/ui";
import { useSession } from "@/lib/session";

interface LeaveType { id: string; key: string; name: string; quota: number | null; isPaid: boolean; isActive: boolean }
interface Balance { leaveTypeId: string; name: string; quota: number | null; approved: number; pending: number; remaining: number | null }
interface LeaveRow {
  id: string; employeeId: string; employeeName?: string; employeeCode?: string | null;
  leaveTypeId: string; leaveTypeName?: string; isPaid?: boolean;
  startDate: string; endDate: string; workingDays: number; reason: string;
  status: string; decisionComment: string | null; source: string; createdAt: string;
}
interface ListRes { data: LeaveRow[]; page: number; limit: number; total: number }

export default function LeavePage() {
  const { user } = useSession();
  const isDecisionMaker = user?.role === "admin" || user?.role === "hr";
  const isSelfService = user?.role === "employee" || user?.role === "hr"; // HR also applies for self

  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balance, setBalance] = useState<Balance[] | null>(null);
  const [list, setList] = useState<ListRes | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Smart leave
  const [smartText, setSmartText] = useState("");
  const [smartBusy, setSmartBusy] = useState(false);
  const [aiSuggested, setAiSuggested] = useState(false);

  // Apply form
  const [form, setForm] = useState({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
  const [busy, setBusy] = useState(false);

  const [decide, setDecide] = useState<{ row: LeaveRow; approve: boolean } | null>(null);
  const [comment, setComment] = useState("");
  const [cancelRow, setCancelRow] = useState<LeaveRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, l] = await Promise.all([
        api.get<{ leaveTypes: LeaveType[] }>("/api/leave-types"),
        api.get<ListRes>(`/api/leave${qs({ status: statusFilter, limit: 50 })}`),
      ]);
      setTypes(t.leaveTypes.filter((x) => x.isActive));
      setList(l);
      if (user?.employeeId) {
        const b = await api.get<{ balances: Balance[] }>(`/api/leave/balance${qs({})}`);
        setBalance(b.balances);
      } else if (user?.role !== "employee") {
        setBalance(null);
      }
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load leave data.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, user]);

  useEffect(() => {
    load();
  }, [load]);

  const smartParse = async () => {
    if (!smartText.trim()) return;
    setSmartBusy(true);
    try {
      const res = await api.post<{ suggestion?: { type: string; start: string; end: string; reason: string }; fallback?: boolean; reason?: string }>("/api/ai/smart-leave", { text: smartText });
      if (res.suggestion) {
        const t = types.find((x) => x.key === res.suggestion!.type) ?? types.find((x) => x.name.toLowerCase() === res.suggestion!.type);
        setForm({
          leaveTypeId: t?.id ?? "",
          startDate: res.suggestion.start,
          endDate: res.suggestion.end,
          reason: res.suggestion.reason,
        });
        setAiSuggested(true);
        toast.success("AI drafted the form — review, edit, then submit.");
      } else {
        setAiSuggested(false);
        toast(res.reason ?? "Could not understand that. Please fill the form manually.", { icon: "✦" });
      }
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "AI request failed. Fill the form manually.");
    } finally {
      setSmartBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await api.post("/api/leave", { ...form, source: aiSuggested ? "ai" : "form" });
      toast.success("Leave request submitted");
      setForm({ leaveTypeId: "", startDate: "", endDate: "", reason: "" });
      setSmartText("");
      setAiSuggested(false);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Could not submit leave request.");
    } finally {
      setBusy(false);
    }
  };

  const decideNow = async () => {
    if (!decide) return;
    setBusy(true);
    try {
      await api.post(`/api/leave/decision${qs({ id: decide.row.id })}`, { approve: decide.approve, comment });
      toast.success(decide.approve ? "Leave approved" : "Leave rejected");
      setDecide(null);
      setComment("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  };

  const cancelNow = async () => {
    if (!cancelRow) return;
    setBusy(true);
    try {
      await api.post(`/api/leave/cancel${qs({ id: cancelRow.id })}`);
      toast.success("Leave cancelled");
      setCancelRow(null);
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Cancel failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title={isSelfService ? "Leave" : "Leave inbox"}
        subtitle={isSelfService ? "Apply, track balances, cancel pending requests" : "Approve or reject requests. A comment is mandatory on reject."}
      />

      {isSelfService && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader
              title="Smart leave"
              subtitle={'Describe it in plain words, e.g. "Need next Monday and Tuesday off for my sister\u2019s wedding"'}
              actions={aiSuggested ? <AISuggestedBadge /> : undefined}
            />
            <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row">
              <input
                value={smartText}
                onChange={(e) => setSmartText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && smartParse()}
                placeholder="Need next Monday and Tuesday off for my sister's wedding"
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none"
              />
              <Button onClick={smartParse} loading={smartBusy}>
                <Wand2 className="h-4 w-4" /> Understand
              </Button>
            </div>
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Application form {aiSuggested && "· pre-filled by AI, editable"}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Leave type *" value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
                  <option value="">— Select —</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.quota !== null ? ` (${t.quota}/yr)` : " (unlimited)"}</option>)}
                </Select>
                <div />
                <Input label="Start date *" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                <Input label="End date *" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                <div className="sm:col-span-2">
                  <Textarea label="Reason *" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Sister's wedding" />
                </div>
              </div>
              <p className="mt-2 text-xs text-slate-400">Working days are counted on the server (weekends and holidays excluded). Overlap and balance rules are re-checked server-side.</p>
              <div className="mt-3 flex justify-end">
                <Button onClick={apply} loading={busy} disabled={!form.leaveTypeId || !form.startDate || !form.endDate || form.reason.trim().length < 5}>
                  Submit request
                </Button>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="My balance" subtitle="Current calendar year" />
            {balance ? (
              <div className="space-y-2 px-5 py-4">
                {balance.map((b) => (
                  <div key={b.leaveTypeId} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{b.name}</p>
                      <p className="text-xs text-slate-400">
                        {b.quota === null ? "unlimited" : `quota ${b.quota}`} · approved {b.approved} · pending {b.pending}
                      </p>
                    </div>
                    <span className={`text-sm font-bold ${b.remaining === 0 ? "text-red-500" : "text-emerald-600"}`}>
                      {b.remaining === null ? "∞" : `${b.remaining} left`}
                    </span>
                  </div>
                ))}
                {balance.length === 0 && <p className="text-sm text-slate-400">No leave types configured.</p>}
              </div>
            ) : (
              <p className="px-5 py-4 text-sm text-slate-400">Admin accounts have no employee record.</p>
            )}
          </Card>
        </div>
      )}

      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-44">
            <option value="">All requests</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !list || list.data.length === 0 ? (
          <Empty title="No leave requests" hint={isSelfService ? "Apply above — or just type your request in plain words." : "Requests will appear here for approval."} />
        ) : (
          <Table head={[...(isDecisionMaker ? ["Employee"] : []), "Type", "Dates", "Days", "Reason", "Status", ""]}>
            {list.data.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {isDecisionMaker && (
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-800">{r.employeeName}</p>
                    <p className="font-mono text-xs text-slate-400">{r.employeeCode}</p>
                  </td>
                )}
                <td className="px-4 py-2.5 text-slate-700">
                  {r.leaveTypeName} {!r.isPaid && <span className="text-xs text-red-400">unpaid</span>}
                  {r.source === "ai" && <span className="ml-1 text-xs text-violet-500">✦</span>}
                </td>
                <td className="px-4 py-2.5 text-slate-600">{r.startDate} → {r.endDate}</td>
                <td className="px-4 py-2.5 font-medium text-slate-800">{r.workingDays}</td>
                <td className="max-w-[200px] px-4 py-2.5"><span className="line-clamp-2 text-sm text-slate-600">{r.reason}</span></td>
                <td className="px-4 py-2.5">
                  <Badge value={r.status} />
                  {r.decisionComment && <p className="mt-0.5 max-w-[160px] text-xs text-slate-400">{r.decisionComment}</p>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    {isDecisionMaker && r.status === "pending" && (
                      <>
                        <Button variant="success" small onClick={() => { setDecide({ row: r, approve: true }); setComment(""); }}>Approve</Button>
                        <Button variant="danger" small onClick={() => { setDecide({ row: r, approve: false }); setComment(""); }}>Reject</Button>
                      </>
                    )}
                    {isSelfService && r.employeeId === user.employeeId && (r.status === "pending" || (r.status === "approved" && r.startDate >= new Date().toISOString().slice(0, 10))) && (
                      <Button variant="ghost" small onClick={() => setCancelRow(r)}>Cancel</Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={!!cancelRow}
        onClose={() => setCancelRow(null)}
        onConfirm={cancelNow}
        title="Cancel leave request"
        message={`Cancel the request for ${cancelRow?.startDate} → ${cancelRow?.endDate}? This cannot be undone.`}
        confirmLabel="Cancel request"
        danger
        loading={busy}
      />

      <LeaveDecisionModal decide={decide} setDecide={setDecide} comment={comment} setComment={setComment} busy={busy} onConfirm={decideNow} />
    </div>
  );
}

import { Modal } from "@/lib/ui";

function LeaveDecisionModal({
  decide, setDecide, comment, setComment, busy, onConfirm,
}: {
  decide: { row: LeaveRow; approve: boolean } | null;
  setDecide: (v: null) => void;
  comment: string;
  setComment: (v: string) => void;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.approve ? "Approve leave" : "Reject leave"}>
      {decide && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {decide.row.employeeName ?? "Your request"} · {decide.row.leaveTypeName} · {decide.row.startDate} → {decide.row.endDate} ({decide.row.workingDays} working days)
          </p>
          <Textarea label="Comment (mandatory on reject)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDecide(null)}>Cancel</Button>
            <Button variant={decide.approve ? "success" : "danger"} onClick={onConfirm} loading={busy} disabled={!decide.approve && !comment.trim()}>
              {decide.approve ? "Approve" : "Reject"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
