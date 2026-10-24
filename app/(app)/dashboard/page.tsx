"use client";

import { useSession } from "@/lib/session";
import { AdminDashboard, HRDashboard, EmployeeDashboard } from "@/components/dashboards";
import { Loading } from "@/lib/ui";

export default function DashboardPage() {
  const { loading, user } = useSession();
  if (loading || !user) return <Loading />;
  if (user.role === "admin") return <AdminDashboard />;
  if (user.role === "hr") return <HRDashboard />;
  return <EmployeeDashboard />;
}
