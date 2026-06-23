// @ts-nocheck
"use client";

// Mirror of the backend permission catalog (workspaces.PERMISSION_GROUPS). The
// backend is authoritative — every gated route re-checks — this only drives
// what the UI shows. Keep in sync with backend/app/workspaces.py.
import { useSelector } from "react-redux";

export const PERMISSION_GROUPS = {
  content: ["posts.read", "posts.create", "posts.update", "posts.delete", "posts.publish"],
  ai: ["ai.generate", "media.generate"],
  media: ["media.read", "media.upload", "media.delete"],
  automation: ["automation.read", "automation.write", "automation.validate"],
  connections: ["connections.read", "connections.manage"],
  settings: ["settings.read", "settings.manage"],
  team: [
    "members.read",
    "members.invite",
    "members.manage",
    "roles.read",
    "roles.manage",
    "workspace.manage",
  ],
};

export const PERMISSION_GROUP_LABELS = {
  content: "Contenu",
  ai: "IA",
  media: "Médias",
  automation: "Automatisation",
  connections: "Connexions",
  settings: "Paramètres",
  team: "Équipe & accès",
};

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

/** True when the signed-in user's workspace role grants `permission`. A null
 *  permission means "no gate" (always visible). */
export function hasPermission(user, permission) {
  if (!permission) return true;
  const perms = user?.permissions;
  return Array.isArray(perms) && perms.includes(permission);
}

export function hasAnyPermission(user, permissions = []) {
  return permissions.some((p) => hasPermission(user, p));
}

/** Hook form — re-renders when the user (and thus permissions) change. */
export function usePermission(permission) {
  const user = useSelector((s: any) => s.auth.user);
  return hasPermission(user, permission);
}
