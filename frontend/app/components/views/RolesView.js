"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Button,
  Input,
  Checkbox,
  Tag,
  Popconfirm,
  Typography,
  Empty,
  message,
} from "antd";
import {
  SafetyCertificateOutlined,
  PlusOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import {
  PERMISSION_GROUPS,
  PERMISSION_GROUP_LABELS,
} from "../../lib/permissions";
import { usePermission } from "../../lib/permissions";
import {
  fetchRoles,
  createRole,
  updateRole,
  deleteRole,
} from "../../lib/workspaceService";

const { Title, Text } = Typography;

const NEW_ROLE = { id: null, name: "", permissions: [], is_system: false };

export default function RolesView() {
  const canManage = usePermission("roles.manage");
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // {id, name, permissions, is_system}
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetchRoles();
    setRoles(r);
    setLoading(false);
    return r;
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Owner permissions are immutable; any system role is read-only here.
  const locked = !!draft?.is_system || !canManage;
  const ownerLocked = draft?.name === "Owner";

  const permSet = useMemo(
    () => new Set(draft?.permissions || []),
    [draft],
  );

  const toggle = (perm, on) => {
    setDraft((d) => {
      const next = new Set(d.permissions);
      if (on) next.add(perm);
      else next.delete(perm);
      return { ...d, permissions: [...next] };
    });
  };

  const onSave = async () => {
    const name = (draft.name || "").trim();
    if (!name) {
      message.error("Le nom du rôle est requis.");
      return;
    }
    setSaving(true);
    try {
      if (draft.id) {
        await updateRole(draft.id, { name, permissions: draft.permissions });
        message.success("Rôle mis à jour.");
      } else {
        await createRole(name, draft.permissions);
        message.success("Rôle créé.");
      }
      const fresh = await reload();
      const match = fresh.find((r) => r.name === name);
      setDraft(match ? { ...match } : null);
    } catch (err) {
      message.error(err?.message || "Échec de l'enregistrement du rôle.");
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (role) => {
    try {
      await deleteRole(role.id);
      message.success("Rôle supprimé.");
      if (draft?.id === role.id) setDraft(null);
      reload();
    } catch (err) {
      message.error(err?.message || "Impossible de supprimer ce rôle.");
    }
  };

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <Title level={3} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SafetyCertificateOutlined /> Rôles &amp; permissions
      </Title>
      <Text type="secondary">
        Les rôles intégrés (Owner, Admin, Editor, Viewer) ne sont pas
        modifiables. Créez des rôles personnalisés pour adapter finement les
        accès.
      </Text>

      <div style={{ display: "flex", gap: 24, marginTop: 20, flexWrap: "wrap" }}>
        {/* Role list */}
        <div style={{ width: 240, flexShrink: 0 }}>
          {canManage && (
            <Button
              block
              icon={<PlusOutlined />}
              onClick={() => setDraft({ ...NEW_ROLE })}
              style={{ marginBottom: 12 }}
            >
              Nouveau rôle
            </Button>
          )}
          {roles.map((r) => (
            <div
              key={r.id}
              onClick={() => setDraft({ ...r })}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                cursor: "pointer",
                marginBottom: 6,
                border:
                  draft?.id === r.id
                    ? "1px solid var(--accent-primary)"
                    : "1px solid var(--border-default)",
                background:
                  draft?.id === r.id ? "rgba(29,63,190,.08)" : "var(--bg-card)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {r.is_system ? (
                <Tag color={r.name === "Owner" ? "gold" : "default"}>système</Tag>
              ) : canManage ? (
                <Popconfirm
                  title="Supprimer ce rôle ?"
                  okText="Supprimer"
                  cancelText="Annuler"
                  onConfirm={(e) => {
                    e?.stopPropagation?.();
                    onDelete(r);
                  }}
                >
                  <DeleteOutlined
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: "#cf1322" }}
                  />
                </Popconfirm>
              ) : null}
            </div>
          ))}
          {!loading && roles.length === 0 && <Empty description="Aucun rôle" />}
        </div>

        {/* Editor */}
        <div style={{ flex: 1, minWidth: 320 }}>
          {!draft ? (
            <Empty description="Sélectionnez un rôle ou créez-en un" />
          ) : (
            <div
              style={{
                border: "1px solid var(--border-default)",
                borderRadius: 16,
                padding: 20,
                background: "var(--bg-card)",
              }}
            >
              <label
                style={{
                  display: "block",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: ".08em",
                  color: "var(--text-muted)",
                  marginBottom: 6,
                }}
              >
                Nom du rôle
              </label>
              <Input
                value={draft.name}
                disabled={locked}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                style={{ marginBottom: 20, maxWidth: 320 }}
              />

              {Object.entries(PERMISSION_GROUPS).map(([group, perms]) => (
                <div key={group} style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      marginBottom: 8,
                      color: "var(--text-primary)",
                    }}
                  >
                    {PERMISSION_GROUP_LABELS[group] || group}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
                      gap: 6,
                    }}
                  >
                    {perms.map((perm) => (
                      <Checkbox
                        key={perm}
                        checked={permSet.has(perm)}
                        disabled={locked || ownerLocked}
                        onChange={(e) => toggle(perm, e.target.checked)}
                      >
                        <span style={{ fontSize: 12 }}>{perm}</span>
                      </Checkbox>
                    ))}
                  </div>
                </div>
              ))}

              {canManage && !draft.is_system && (
                <Button
                  type="primary"
                  loading={saving}
                  onClick={onSave}
                  style={{ marginTop: 8 }}
                >
                  {draft.id ? "Enregistrer" : "Créer le rôle"}
                </Button>
              )}
              {draft.is_system && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Ce rôle intégré ne peut pas être modifié.
                </Text>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
