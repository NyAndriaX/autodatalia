import { notFound } from "next/navigation";
import { dashboardViewFromSegment } from "../../dashboard/viewRoutes";

// Validates the route segment; shell layout handles rendering.
export default async function AppViewPage({ params }) {
  const { view } = await params;
  if (!dashboardViewFromSegment(view)) notFound();
  return null;
}
