"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Checkbox,
  Tag,
  Typography,
  Empty,
  message,
  Table,
} from "antd";
import {
  SafetyCertificateOutlined,
  LockOutlined,
} from "@ant-design/icons";
import {
  mutedText,
  pageContainer,
  pageSurface,
  sectionEyebrow,
} from "../../lib/uiClasses";
import { PERMISSION_GROUPS, usePermission } from "../../lib/permissions";
import {
  fetchRoles,
  updateRole,
} from "../../lib/workspaceService";

const { Text } = Typography;

export default function RolesView({ embedded = false }) {
  const t = useTranslations("team");
  const tp = useTranslations("permissions");
  const canManage = usePermission("roles.manage");
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const r = await fetchRoles();
    setRoles(r);
    setDrafts(
      Object.fromEntries(
        r.map((role) => [role.id, [...(role.permissions || [])]])
      )
    );
    setLoading(false);
    return r;
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      reload();
    });
  }, [reload]);

  const rows = useMemo(
    () =>
      Object.entries(PERMISSION_GROUPS).flatMap(([group, perms]) =>
        perms.map((permission) => ({ key: permission, group, permission }))
      ),
    []
  );

  const toggle = (roleId, perm, on) => {
    setDrafts((current) => {
      const next = new Set(current[roleId] || []);
      if (on) next.add(perm);
      else next.delete(perm);
      return { ...current, [roleId]: [...next] };
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      for (const role of roles) {
        if (role.is_system) continue;
        await updateRole(role.id, {
          name: role.name,
          permissions: drafts[role.id] || [],
        });
      }
      message.success(t("roleSaved"));
      await reload();
    } catch (err) {
      message.error(err?.message || t("roleSaveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const roleColumns: any[] = roles.map((role) => ({
    title: (
      <Tag color={role.name === "Owner" || role.name === "Admin" ? "red" : role.name === "Editor" ? "gold" : "default"}>
        {role.name}
      </Tag>
    ),
    key: role.id,
    align: "center",
    width: 112,
    render: (_, row) => {
      if (role.is_system || !canManage) {
        return <LockOutlined style={{ color: "#94a3b8" }} title={t("roleImmutable")} />;
      }
      return (
        <Checkbox
          checked={(drafts[role.id] || []).includes(row.permission)}
          onChange={(e) => toggle(role.id, row.permission, e.target.checked)}
        />
      );
    },
  }));

  const columns: any[] = [
    {
      title: "Catégorie",
      dataIndex: "group",
      width: 150,
      render: (group) => <Text type="secondary">{tp(`groups.${group}`)}</Text>,
      onCell: (row, index) => {
        const i = index ?? 0;
        const first = rows.findIndex((r) => r.group === row.group);
        if (i !== first) return { rowSpan: 0 };
        return { rowSpan: rows.filter((r) => r.group === row.group).length };
      },
    },
    {
      title: "Permission",
      dataIndex: "permission",
      render: (permission) => <span>{tp(`labels.${permission}`)}</span>,
    },
    ...roleColumns,
  ];

  const content = (
    <div>
      {!embedded && (
        <div className="settings-section-header">
          <div>
            <h2><SafetyCertificateOutlined /> {t("rolesTitle")}</h2>
            <p>{t("rolesSubtitle")}</p>
          </div>
        </div>
      )}

      <div className="pro-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div>
            <h2 className="m-0 flex items-center gap-2 text-xl font-bold tracking-[-0.02em] text-[#0f172a]">
              <SafetyCertificateOutlined /> {t("rolesTitle")}
            </h2>
            <Typography.Paragraph type="secondary" style={{ margin: "8px 0 0", fontSize: 13 }}>
              {t("rolesSubtitle")}
            </Typography.Paragraph>
          </div>
          {canManage && (
            <Button type="primary" loading={saving} onClick={onSave}>
              {t("save")}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="p-10 text-center">
            <Text type="secondary">Chargement...</Text>
          </div>
        ) : roles.length === 0 ? (
          <div className="p-10">
            <Empty description={t("noRole")} />
          </div>
        ) : (
          <Table
            rowKey="key"
            pagination={false}
            size="small"
            dataSource={rows}
            columns={columns}
            scroll={{ x: "max-content" }}
          />
        )}
      </div>
    </div>
  );

  if (embedded) return content;

  return (
    <div className={pageSurface}>
      <div className={pageContainer}>
        {content}
      </div>
    </div>
  );
}
