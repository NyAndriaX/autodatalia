import DashboardShell from "../dashboard/DashboardShell";

/**
 * Persistent shell layout for all authenticated app routes.
 * By living in a layout (not individual pages), DashboardShell is never
 * unmounted when the user navigates between views — no flicker.
 * The children slot is intentionally unused: the shell renders its own
 * view based on Redux state + URL via usePathname().
 */
export default function AppLayout() {
  return <DashboardShell />;
}
