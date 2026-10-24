"use client";

// App shell: role-based sidebar, header with notification bell + AI panel,
// forced-password-change redirect, mobile responsive (375px+).
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Settings2, Users, UserPlus, CalendarCheck, CalendarDays, Wallet,
  Megaphone, ScrollText, Bell, Sparkles, LogOut, Building2, ClipboardList, FileText, Menu, X,
} from "lucide-react";
import toast from "react-hot-toast";
import { useSession } from "@/lib/session";
import { api, qs } from "@/lib/client";
import { Loading, Button } from "@/lib/ui";
import AIChatDrawer from "@/components/AIChatDrawer";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: Array<"admin" | "hr" | "employee">;
}

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["admin", "hr", "employee"] },
  { href: "/settings", label: "Settings", icon: Settings2, roles: ["admin"] },
  { href: "/users", label: "Users (HR logins)", icon: UserPlus, roles: ["admin"] },
  { href: "/employees", label: "Employees", icon: Users, roles: ["admin", "hr"] },
  { href: "/attendance", label: "Attendance", icon: CalendarCheck, roles: ["admin", "hr", "employee"] },
  { href: "/corrections", label: "Corrections", icon: ClipboardList, roles: ["admin", "hr", "employee"] },
  { href: "/leave", label: "Leave", icon: CalendarDays, roles: ["admin", "hr", "employee"] },
  { href: "/payroll", label: "Payroll", icon: Wallet, roles: ["admin", "hr"] },
  { href: "/payslips", label: "Payslips", icon: FileText, roles: ["admin", "hr", "employee"] },
  { href: "/announcements", label: "Announcements", icon: Megaphone, roles: ["admin", "hr", "employee"] },
  { href: "/audit", label: "Audit log", icon: ScrollText, roles: ["admin"] },
];

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string;
  type: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const { loading, user, company, logout, refresh } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user?.mustChangePassword) router.replace("/change-password");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = async () => {
      try {
        const res = await api.get<{ notifications: NotificationRow[]; unread: number }>(`/api/notifications${qs({})}`);
        if (active) {
          setNotifications(res.notifications.slice(0, 12));
          setUnread(res.unread);
        }
      } catch {
        /* silent */
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [user, pathname]);

  if (loading || !user) return <Loading label="Loading workspace…" />;

  const items = NAV.filter((n) => n.roles.includes(user.role));
  const companyName = company || "HCM Lite";

  const markRead = async (id: string) => {
    await api.post(`/api/notifications${qs({ id, action: "read" })}`);
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
  };
  const markAll = async () => {
    await api.post("/api/notifications?action=read-all");
    setNotifications((ns) => ns.map((n) => ({ ...n, isRead: true })));
    setUnread(0);
    toast.success("All notifications marked as read");
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          menuOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-4">
          <span className="rounded-lg bg-slate-900 p-1.5"><Building2 className="h-4 w-4 text-white" /></span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900">{companyName}</p>
            <p className="text-xs text-slate-400">HCM Lite</p>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>
        <nav className="space-y-0.5 p-3">
          {items.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-slate-100 p-3">
          <div className="mb-2 px-2">
            <p className="truncate text-sm font-medium text-slate-800">{user.name}</p>
            <p className="truncate text-xs uppercase tracking-wide text-slate-400">{user.role}</p>
          </div>
          <Button variant="secondary" small className="w-full" onClick={() => logout().then(() => refresh())}>
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </Button>
        </div>
      </aside>

      {menuOpen && <div className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden" onClick={() => setMenuOpen(false)} />}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
          <button className="lg:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5 text-slate-500" />
          </button>
          <p className="hidden text-sm font-medium text-slate-500 sm:block">{items.find((i) => pathname.startsWith(i.href))?.label ?? ""}</p>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setAiOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-700 hover:bg-violet-100"
            >
              <Sparkles className="h-4 w-4" /> <span className="hidden sm:inline">AI Assistant</span>
            </button>
            <div className="relative">
              <button onClick={() => setBellOpen((b) => !b)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 mt-1 max-h-96 w-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <p className="text-sm font-semibold text-slate-700">Notifications</p>
                    <button onClick={markAll} className="text-xs text-slate-500 underline">mark all read</button>
                  </div>
                  {notifications.length === 0 && <p className="px-3 py-6 text-center text-xs text-slate-400">No notifications yet.</p>}
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => !n.isRead && markRead(n.id)}
                      className={`block w-full border-b border-slate-50 px-3 py-2.5 text-left hover:bg-slate-50 ${n.isRead ? "opacity-60" : ""}`}
                    >
                      <p className="text-xs font-semibold text-slate-800">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
      </div>

      <AIChatDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}
