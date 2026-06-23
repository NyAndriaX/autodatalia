import { notFound } from "next/navigation";
import { dashboardViewFromSegment } from "../../../dashboard/viewRoutes";

// Legacy /dashboard/:view routes — validates and hands off to the shell layout.
export default async function DashboardViewPage({ params }) {
  const { view } = await params;
  if (!dashboardViewFromSegment(view)) notFound();
  return null;
}
