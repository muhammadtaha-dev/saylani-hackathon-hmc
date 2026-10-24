"use client";

// Attendance corrections: employees request with a reason; HR/Admin decide.
import React, { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import { api, ApiClientError, qs } from "@/lib/client";
import { Badge, Button, Card, Empty, ErrorState, Input, Loading, Modal, PageHeader, Select, Table, Textarea } from "@/lib/ui";
import { useSession } from "@/lib/session";

interface Correction {
  id: string; employeeId: string; employeeName?: string; employeeCode?: string | null;
  date: string; requestedCheckIn: string | null; requestedCheckOut: string | null;
  reason: string; status: string; decisionComment: string | null; createdAt: string;
}

function localToIso(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

export default function CorrectionsPage() {
  const { user } = useSession();
  const [rows, setRows] = useState<Correction[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), checkIn: "", checkOut: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [decide, setDecide] = useState<{ row: Correction; approve: boolean } | null>(null);
  const [comment, setComment] = useState("");

  const isDecisionMaker = user?.role === "admin" || user?.role === "hr";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ corrections: Correction[] }>(`/api/attendance/corrections${qs({ status: statusFilter })}`);
      setRows(res.corrections);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load corrections.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setBusy(true);
    try {
      await api.post("/api/attendance/corrections", {
        date: form.date,
        requestedCheckIn: localToIso(form.checkIn),
        requestedCheckOut: localToIso(form.checkOut),
        reason: form.reason,
      });
      toast.success("Correction request submitted");
      setOpen(false);
      setForm({ date: new Date().toISOString().slice(0, 10), checkIn: "", checkOut: "", reason: "" });
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const decideNow = async () => {
    if (!decide) return;
    setBusy(true);
    try {
      await api.put(`/api/attendance/corrections${qs({ id: decide.row.id })}`, { approve: decide.approve, comment });
      toast.success(decide.approve ? "Correction approved — attendance updated" : "Correction rejected");
      setDecide(null);
      setComment("");
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Decision failed.");
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;

  return (
    <div>
      <PageHeader
        title="Attendance corrections"
        subtitle={isDecisionMaker ? "Approve or reject employee requests. Approval writes the attendance record and is audited." : "Wrong check-in/out time? Request a correction with a reason."}
        actions={
          !isDecisionMaker && <Button small onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> Request correction</Button>
        }
      />

      <Card className="mb-4 p-3">
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="!w-44">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </Select>
      </Card>

      <Card>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !rows || rows.length === 0 ? (
          <Empty title="No correction requests" hint={isDecisionMaker ? "Employee requests will appear here." : "Request a correction if a check-in/out was recorded wrongly."} />
        ) : (
          <Table head={isDecisionMaker ? ["Employee", "Date", "Requested", "Reason", "Status", ""] : ["Date", "Requested", "Reason", "Status", "Decision"]}>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {isDecisionMaker && <td className="px-4 py-2.5 font-medium text-slate-800">{r.employeeName} <span className="font-mono text-xs text-slate-400">{r.employeeCode}</span></td>}
                <td className="px-4 py-2.5 text-slate-700">{r.date}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {r.requestedCheckIn && <>In {new Date(r.requestedCheckIn).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} </>}
                  {r.requestedCheckOut && <>· Out {new Date(r.requestedCheckOut).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</>}
                  {!r.requestedCheckIn && !r.requestedCheckOut && "—"}
                </td>
                <td className="max-w-xs px-4 py-2.5 text-sm text-slate-600"><span className="line-clamp-2">{r.reason}</span></td>
                <td className="px-4 py-2.5"><Badge value={r.status} /></td>
                <td className="px-4 py-2.5">
                  {isDecisionMaker ? (
                    r.status === "pending" ? (
                      <div className="flex justify-end gap-1">
                        <Button variant="success" small onClick={() => { setDecide({ row: r, approve: true }); setComment(""); }}>Approve</Button>
                        <Button variant="danger" small onClick={() => { setDecide({ row: r, approve: false }); setComment(""); }}>Reject</Button>
                      </div>
                    ) : (
                      <span className="block text-right text-xs text-slate-400">{r.decisionComment ?? ""}</span>
                    )
                  ) : (
                    <span className="block text-xs text-slate-400">{r.decisionComment ?? ""}</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request attendance correction">
        <div className="space-y-3">
          <Input label="Date" type="date" max={new Date().toISOString().slice(0, 10)} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Requested check-in" type="datetime-local" value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            <Input label="Requested check-out" type="datetime-local" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
          </div>
          <Textarea label="Reason (min 10 characters)" rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} loading={busy} disabled={form.reason.trim().length < 10}>Submit request</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!decide} onClose={() => setDecide(null)} title={decide?.approve ? "Approve correction" : "Reject correction"}>
        {decide && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {decide.row.employeeName} · {decide.row.date}
              {decide.approve && " — approving will update the attendance record (source: correction)."}
            </p>
            <Textarea label="Decision comment (required)" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDecide(null)}>Cancel</Button>
              <Button variant={decide.approve ? "success" : "danger"} onClick={decideNow} loading={busy} disabled={!comment.trim()}>
                {decide.approve ? "Approve" : "Reject"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
