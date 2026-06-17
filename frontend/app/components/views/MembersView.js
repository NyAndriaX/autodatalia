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
} from "antd";
import { TeamOutlined, MailOutlined, DeleteOutlined, UserDeleteOutlined } from "@ant-design/icons";
import { usePermission } from "../../lib/permissions";
import {
  fetchMembers,
  fetchRoles,
  fetchInvitations,
  inviteMember,
  changeMemberRole,
  removeMember,
  deleteMemberAccount,
  revokeInvitation,
} from "../../lib/workspaceService";

const { Title, Text } = Typography;

export default function MembersView() {
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
    reload();
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

  const onDeleteAccount = async (userId) => {
    try {
      await deleteMemberAccount(userId);
      message.success(t("memberAccountDeleted"));
      reload();
    } catch (err) {
      message.error(err?.message || t("deleteAccountMemberFailed"));
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
            <Popconfirm
              title={t("deleteAccountMemberConfirm")}
              okText={t("deleteAccountMember")}
              okButtonProps={{ danger: true }}
              cancelText={t("cancel")}
              onConfirm={() => onDeleteAccount(m.user_id)}
            >
              <Button size="small" danger type="text" icon={<UserDeleteOutlined />} title={t("deleteAccountMember")} />
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

  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <Title level={3} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamOutlined /> {t("membersTitle")}
      </Title>
      <Text type="secondary">{t("membersSubtitle")}</Text>

      {canInvite && (
        <div
          style={{
            display: "flex",
            gap: 8,
            margin: "20px 0",
            flexWrap: "wrap",
          }}
        >
          <Input
            style={{ flex: 1, minWidth: 220 }}
            prefix={<MailOutlined />}
            placeholder={t("invitePlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={onInvite}
          />
          <Select
            style={{ width: 160 }}
            value={roleId}
            options={roleOptions}
            onChange={setRoleId}
            placeholder={t("colRole")}
          />
          <Button type="primary" loading={inviting} onClick={onInvite}>
            {t("invite")}
          </Button>
        </div>
      )}

      <Table
        rowKey="user_id"
        loading={loading}
        columns={memberCols}
        dataSource={members}
        pagination={false}
        scroll={{ x: "max-content" }}
        style={{ marginTop: 16 }}
      />

      {invites.length > 0 && (
        <>
          <Title level={5} style={{ marginTop: 32 }}>
            {t("pendingInvites")}
          </Title>
          <Table
            rowKey="id"
            columns={inviteCols}
            dataSource={invites}
            pagination={false}
            scroll={{ x: "max-content" }}
          />
        </>
      )}
    </div>
  );
}
