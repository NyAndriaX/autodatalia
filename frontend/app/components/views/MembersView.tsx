"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Table,
  Select,
  Button,
  Input,
  Tag,
  Popconfirm,
  Typography,
  message,
  Card,
  Form,
  Statistic,
  Space,
} from "antd";
import { TeamOutlined, MailOutlined, DeleteOutlined } from "@ant-design/icons";
import {
  btnPrimary,
  mutedText,
  pageContainer,
  pageHero,
  pageHeroSubtitle,
  pageHeroTitle,
  pageSurface,
  panelCard,
  sectionEyebrow,
} from "../../lib/uiClasses";
import { usePermission } from "../../lib/permissions";
import {
  fetchMembers,
  fetchRoles,
  fetchInvitations,
  inviteMember,
  changeMemberRole,
  removeMember,
  revokeInvitation,
} from "../../lib/workspaceService";

const { Title, Text } = Typography;

export default function MembersView({ embedded = false }) {
  const t = useTranslations("team");
  const canManage = usePermission("members.manage");
  const canInvite = usePermission("members.invite");

  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(null);
  const [inviting, setInviting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    const [m, r, i] = await Promise.all([
      fetchMembers(),
      fetchRoles(),
      fetchInvitations(),
    ]);
    setMembers(m);
    setRoles(r);
    setInvites(i);
    if (!roleId && r.length) {
      const editor = r.find((x) => x.name === "Editor") || r[0];
      setRoleId(editor.id);
    }
    setLoading(false);
  }, [roleId]);

  useEffect(() => {
    queueMicrotask(() => {
      reload();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));

  const onInvite = async () => {
    const target = email.trim();
    if (!target || !target.includes("@")) {
      message.error(t("invalidEmail"));
      return;
    }
    setInviting(true);
    try {
      await inviteMember(target, roleId);
      message.success(t("inviteSent", { email: target }));
      setEmail("");
      reload();
    } catch (err) {
      message.error(err?.message || t("inviteFailed"));
    } finally {
      setInviting(false);
    }
  };

  const onChangeRole = async (userId, newRoleId) => {
    try {
      await changeMemberRole(userId, newRoleId);
      message.success(t("roleUpdated"));
      reload();
    } catch (err) {
      message.error(err?.message || t("roleChangeFailed"));
    }
  };

  const onRemove = async (userId) => {
    try {
      await removeMember(userId);
      message.success(t("memberRemoved"));
      reload();
    } catch (err) {
      message.error(err?.message || t("removeMemberFailed"));
    }
  };

  const onRevoke = async (id) => {
    try {
      await revokeInvitation(id);
      message.success(t("inviteRevoked"));
      reload();
    } catch (err) {
      message.error(err?.message || t("revokeFailed"));
    }
  };

  const memberCols = [
    {
      title: t("colMember"),
      dataIndex: "email",
      render: (_, m) => (
        <div>
          <div style={{ fontWeight: 600 }}>{m.full_name || m.email}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {m.email}
            {m.is_self ? ` ${t("you")}` : ""}
          </Text>
        </div>
      ),
    },
    {
      title: t("colRole"),
      dataIndex: "role_name",
      width: 200,
      render: (roleName, m) =>
        m.is_owner || m.is_self || !canManage ? (
          <Tag color={m.is_owner ? "gold" : "blue"}>{roleName}</Tag>
        ) : (
          <Select
            size="small"
            style={{ width: 160 }}
            value={m.role_id}
            options={roleOptions}
            onChange={(v) => onChangeRole(m.user_id, v)}
          />
        ),
    },
    {
      title: "",
      width: 90,
      align: "right",
      render: (_, m) =>
        canManage && !m.is_owner && !m.is_self ? (
          <span style={{ display: "inline-flex", gap: 4 }}>
            <Popconfirm
              title={t("removeMemberConfirm")}
              okText={t("remove")}
              cancelText={t("cancel")}
              onConfirm={() => onRemove(m.user_id)}
            >
              <Button size="small" danger type="text" icon={<DeleteOutlined />} title={t("removeMemberConfirm")} />
            </Popconfirm>
          </span>
        ) : null,
    },
  ];

  const inviteCols = [
    { title: t("colInviteEmail"), dataIndex: "email" },
    { title: t("colRole"), dataIndex: "role_name", width: 160, render: (r) => <Tag>{r}</Tag> },
    {
      title: "",
      width: 90,
      align: "right",
      render: (_, inv) =>
        canInvite ? (
          <Popconfirm
            title={t("revokeConfirm")}
            okText={t("revoke")}
            cancelText={t("cancel")}
            onConfirm={() => onRevoke(inv.id)}
          >
            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null,
    },
  ];

  const content = (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <div className={`${pageHero}`}>
          <p className={`${sectionEyebrow} mb-2`}>{t("workspaceLabel")}</p>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <Title level={3} className={pageHeroTitle} style={{ display: "flex", alignItems: "center", gap: 10, margin: 0 }}>
                <TeamOutlined /> {t("membersTitle")}
              </Title>
              <p className={pageHeroSubtitle}>{t("membersSubtitle")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right">
              <div className={`${panelCard} px-4 py-3`}>
                <p className={sectionEyebrow}>{t("colMember")}</p>
                <p className="text-2xl font-extrabold" style={{ color: "var(--text-primary)" }}>{members.length}</p>
              </div>
              <div className={`${panelCard} px-4 py-3`}>
                <p className={sectionEyebrow}>{t("pendingInvites")}</p>
                <p className="text-2xl font-extrabold" style={{ color: "var(--text-primary)" }}>{invites.length}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {embedded && (
        <div className="settings-section-header">
          <div>
            <h2><TeamOutlined /> {t("membersTitle")}</h2>
            <p>{t("membersSubtitle")}</p>
          </div>
          <Space size={12} wrap>
            <Card size="small" style={{ minWidth: 132, borderRadius: 12 }}>
              <Statistic title={t("colMember")} value={members.length} />
            </Card>
            <Card size="small" style={{ minWidth: 132, borderRadius: 12 }}>
              <Statistic title={t("pendingInvites")} value={invites.length} />
            </Card>
          </Space>
        </div>
      )}

      {canInvite && (
        <Card
          size="small"
          title={t("invite")}
          className="pro-card"
          styles={{ body: { padding: 16 } }}
        >
          <Form layout="vertical" requiredMark={false} onFinish={onInvite}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(260px,1fr)_220px_auto] md:items-end">
              <Form.Item label={t("invite")} style={{ marginBottom: 0 }}>
                <Input
                  size="large"
                  prefix={<MailOutlined />}
                  placeholder={t("invitePlaceholder")}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onPressEnter={onInvite}
                />
              </Form.Item>
              <Form.Item label={t("colRole")} style={{ marginBottom: 0 }}>
                <Select
                  size="large"
                  value={roleId}
                  options={roleOptions}
                  onChange={setRoleId}
                  placeholder={t("colRole")}
                />
              </Form.Item>
              <Button type="primary" size="large" loading={inviting} onClick={onInvite}>
                {t("invite")}
              </Button>
            </div>
          </Form>
        </Card>
      )}

      <div className="pro-card overflow-hidden">
        {!embedded && (
          <div className="border-b border-[#f1f5f9] px-5 py-4">
            <p className="text-sm font-bold text-[#0f172a]">{t("membersTitle")}</p>
            <p className={mutedText}>{t("membersSubtitle")}</p>
          </div>
        )}
        <Table
          rowKey="user_id"
          loading={loading}
          columns={memberCols as any}
          dataSource={members}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      </div>

      {invites.length > 0 && (
        <div className="pro-card overflow-hidden">
          <div className="border-b border-[#f1f5f9] px-5 py-4">
            <p className="text-sm font-bold text-[#0f172a]">{t("pendingInvites")}</p>
          </div>
          <Table
            rowKey="id"
            columns={inviteCols as any}
            dataSource={invites}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        </div>
      )}
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
