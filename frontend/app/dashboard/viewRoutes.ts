export const DASHBOARD_SECTIONS = [
  { id: "content", titleKey: "sectionContent" },
  { id: "automation", titleKey: "sectionAutomation" },
  { id: "performance", titleKey: "sectionPerformance" },
  { id: "team", titleKey: "sectionTeam" },
  { id: "account", titleKey: "sectionAccount" },
];

export const DASHBOARD_VIEW_REGISTRY = {
  dashboard: {
    path: "/dashboard",
    legacyPath: "/dashboard",
    section: "content",
    icon: "dashboard",
    label: { namespace: "sidebar", key: "dashboard" },
    topbar: { titleKey: "viewDashboardTitle", subtitleKey: "viewDashboardSubtitle", breadcrumbKey: "breadcrumbHome" },
  },
  creation: {
    path: "/creation",
    legacyPath: "/dashboard/creation",
    section: "content",
    icon: "edit",
    label: { namespace: "creation", key: "title" },
    topbar: { titleKey: "viewCreationTitle", subtitleKey: "viewCreationSubtitle", breadcrumbKey: "breadcrumbContent" },
    primary: true,
  },
  videos: {
    path: "/videos",
    legacyPath: "/dashboard/videos",
    section: "content",
    icon: "video",
    label: { namespace: "sidebar", key: "videos" },
    topbar: { titleKey: "viewVideosTitle", subtitleKey: "viewVideosSubtitle", breadcrumbKey: "breadcrumbAutomation" },
  },
  image: {
    path: "/image",
    legacyPath: "/dashboard/image",
    section: "content",
    icon: "image",
    label: { namespace: "sidebar", key: "imageStudio" },
    topbar: { namespace: "imageStudio", titleKey: "title", subtitleKey: "subtitle", breadcrumbKey: "breadcrumbContent" },
  },
  calendar: {
    path: "/calendar",
    legacyPath: "/dashboard/calendar",
    section: "content",
    icon: "calendar",
    label: { namespace: "sidebar", key: "calendar" },
    topbar: { titleKey: "viewCalendarTitle", subtitleKey: "viewCalendarSubtitle", breadcrumbKey: "breadcrumbContent" },
  },
  library: {
    path: "/library",
    legacyPath: "/dashboard/library",
    section: "content",
    icon: "library",
    label: { namespace: "sidebar", key: "library" },
    topbar: { titleKey: "viewLibraryTitle", subtitleKey: "viewLibrarySubtitle", breadcrumbKey: "breadcrumbContent" },
  },
  automation: {
    path: "/automation",
    legacyPath: "/dashboard/automation",
    section: "automation",
    icon: "automation",
    label: { namespace: "sidebar", key: "automation" },
    topbar: { titleKey: "viewAutomationTitle", subtitleKey: "viewAutomationSubtitle", breadcrumbKey: "breadcrumbAutomation" },
  },
  analytics: {
    path: "/analytics",
    legacyPath: "/dashboard/analytics",
    section: "performance",
    icon: "analytics",
    label: { namespace: "sidebar", key: "analytics" },
    topbar: { titleKey: "viewAnalyticsTitle", subtitleKey: "viewAnalyticsSubtitle", breadcrumbKey: "breadcrumbPerformance" },
  },
  credits: {
    path: "/credits",
    legacyPath: "/dashboard/credits",
    section: "performance",
    icon: "credits",
    label: { namespace: "sidebar", key: "credits" },
    topbar: { titleKey: "viewCreditsTitle", subtitleKey: "viewCreditsSubtitle", breadcrumbKey: "breadcrumbPerformance" },
  },
  members: {
    path: "/members",
    legacyPath: "/dashboard/members",
    section: "team",
    icon: "members",
    hidden: true,
    permission: "members.read",
    label: { namespace: "team", key: "membersTitle" },
    topbar: { namespace: "team", titleKey: "membersTitle", subtitleKey: "membersSubtitle", breadcrumbKey: "breadcrumbAccount" },
  },
  roles: {
    path: "/roles",
    legacyPath: "/dashboard/roles",
    section: "team",
    icon: "roles",
    hidden: true,
    permission: "roles.read",
    label: { namespace: "team", key: "rolesTitle" },
    topbar: { namespace: "team", titleKey: "rolesTitle", subtitleKey: "rolesSubtitle", breadcrumbKey: "breadcrumbAccount" },
  },
  settings: {
    path: "/settings",
    legacyPath: "/dashboard/settings",
    section: "account",
    icon: "settings",
    label: { namespace: "common", key: "settings" },
    topbar: { titleKey: "viewSettingsTitle", subtitleKey: "viewSettingsSubtitle", breadcrumbKey: "breadcrumbAccount" },
  },
};

export const DASHBOARD_VIEW_ORDER = Object.keys(DASHBOARD_VIEW_REGISTRY);

export const DASHBOARD_VIEW_ROUTES = Object.fromEntries(
  DASHBOARD_VIEW_ORDER.map((view) => [view, DASHBOARD_VIEW_REGISTRY[view].path])
);

export const DASHBOARD_LEGACY_VIEW_ROUTES = Object.fromEntries(
  DASHBOARD_VIEW_ORDER.map((view) => [view, DASHBOARD_VIEW_REGISTRY[view].legacyPath])
);

export const DASHBOARD_VIEW_BY_PATH = Object.fromEntries(
  DASHBOARD_VIEW_ORDER.flatMap((view) => {
    const meta = DASHBOARD_VIEW_REGISTRY[view];
    return [
      [meta.path, view],
      [meta.legacyPath, view],
    ];
  })
);

export const DASHBOARD_NAV_SECTIONS = DASHBOARD_SECTIONS.map((section) => ({
  ...section,
  views: DASHBOARD_VIEW_ORDER.filter(
    (view) => DASHBOARD_VIEW_REGISTRY[view].section === section.id
  ),
})).filter((section) => section.views.length > 0);

export const VALID_DASHBOARD_VIEWS = DASHBOARD_VIEW_ORDER;

export function getDashboardView(view) {
  return DASHBOARD_VIEW_REGISTRY[view] || null;
}

export function dashboardViewPermission(view) {
  return DASHBOARD_VIEW_REGISTRY[view]?.permission || null;
}

export function pathForDashboardView(view) {
  return DASHBOARD_VIEW_ROUTES[view] || DASHBOARD_VIEW_ROUTES.dashboard;
}

export function legacyPathForDashboardView(view) {
  return DASHBOARD_LEGACY_VIEW_ROUTES[view] || DASHBOARD_LEGACY_VIEW_ROUTES.dashboard;
}

export function dashboardViewFromSegment(segment) {
  if (!segment) return "dashboard";
  return VALID_DASHBOARD_VIEWS.includes(segment) ? segment : null;
}

export function dashboardViewFromPathname(pathname) {
  const normalized = pathname === "/" ? "/" : (pathname || "").replace(/\/+$/, "");
  if (DASHBOARD_VIEW_BY_PATH[normalized]) return DASHBOARD_VIEW_BY_PATH[normalized];

  const parts = normalized.split("/").filter(Boolean);
  if (parts[0] === "dashboard") return dashboardViewFromSegment(parts[1]);
  return dashboardViewFromSegment(parts[0]);
}
