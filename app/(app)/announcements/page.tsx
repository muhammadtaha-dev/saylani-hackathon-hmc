"use client";

// Announcements: Admin/HR post; everyone reads. Shown on every dashboard.
import React, { useCallback, useEffect, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import toast from "react-hot-toast";
import { api, ApiClientError, qs } from "@/lib/client";
import { Button, Card, Empty, ErrorState, Input, Loading, Modal, PageHeader, Textarea } from "@/lib/ui";
import { fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";

interface Announcement { id: string; title: string; body: string; postedByName: string; publishedAt: string }

export default function AnnouncementsPage() {
  const { user } = useSession();
  const canPost = user?.role === "admin" || user?.role === "hr";
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", body: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: Announcement[] }>(`/api/announcements${qs({ limit: 50 })}`);
      setRows(res.data);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async () => {
    setBusy(true);
    try {
      await api.post("/api/announcements", form);
      toast.success("Announcement published");
      setOpen(false);
      setForm({ title: "", body: "" });
      load();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Announcements"
        subtitle="Company-wide posts. Every user is notified."
        actions={canPost && <Button small onClick={() => setOpen(true)}><Plus className="h-3.5 w-3.5" /> New announcement</Button>}
      />

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !rows || rows.length === 0 ? (
        <Card>
          <Empty
            title="No announcements yet"
            hint={canPost ? "Post the first update — it appears on every dashboard." : "Updates from Admin/HR will appear here."}
            action={canPost ? <Button small onClick={() => setOpen(true)}><Megaphone className="h-3.5 w-3.5" /> Post one</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => (
            <Card key={a.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Megaphone className="h-4 w-4 text-slate-400" /> {a.title}
                  </h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{a.body}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-400">{a.postedByName} · {fmtDateTime(a.publishedAt)}</p>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New announcement">
        <div className="space-y-3">
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Office closed on Friday" />
          <Textarea label="Body" rows={4} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={post} loading={busy} disabled={form.title.trim().length < 3 || form.body.trim().length < 5}>Publish</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
