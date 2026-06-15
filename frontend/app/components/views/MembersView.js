"use client";

import { useEffect, useState, useCallback } from "react";
import { useSelector } from "react-redux";
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
import { TeamOutlined, MailOutlined, DeleteOutlined } from "@ant-design/icons";
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

export default function MembersView() {
  const user = useSelector((s) => s.auth.user);
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
      message.error("Saisissez une adresse e-mail valide.");
      return;
    }
    setInviting(true);
    try {
      await inviteMember(target, roleId);
      message.success(`Invitation envoyée à ${target}.`);
      setEmail("");
      reload();
    } catch (err) {
      message.error(err?.message || "Échec de l'invitation.");
    } finally {
      setInviting(false);
    }
  };

  const onChangeRole = async (userId, newRoleId) => {
    try {
      await changeMemberRole(userId, newRoleId);
      message.success("Rôle mis à jour.");
      reload();
    } catch (err) {
      message.error(err?.message || "Impossible de changer le rôle.");
    }
  };

  const onRemove = async (userId) => {
    try {
      await removeMember(userId);
      message.success("Membre retiré.");
      reload();
    } catch (err) {
      message.error(err?.message || "Impossible de retirer ce membre.");
    }
  };

  const onRevoke = async (id) => {
    try {
      await revokeInvitation(id);
      message.success("Invitation révoquée.");
      reload();
    } catch (err) {
      message.error(err?.message || "Impossible de révoquer l'invitation.");
    }
  };

  const memberCols = [
    {
      title: "Membre",
      dataIndex: "email",
      render: (_, m) => (
        <div>
          <div style={{ fontWeight: 600 }}>{m.full_name || m.email}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {m.email}
            {m.is_self ? " (vous)" : ""}
          </Text>
        </div>
      ),
    },
    {
      title: "Rôle",
      dataIndex: "role_name",
      width: 200,
      render: (roleName, m) =>
        m.is_owner || !canManage ? (
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
          <Popconfirm
            title="Retirer ce membre du workspace ?"
            okText="Retirer"
            cancelText="Annuler"
            onConfirm={() => onRemove(m.user_id)}
          >
            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null,
    },
  ];

  const inviteCols = [
    { title: "E-mail invité", dataIndex: "email" },
    { title: "Rôle", dataIndex: "role_name", width: 160, render: (r) => <Tag>{r}</Tag> },
    {
      title: "",
      width: 90,
      align: "right",
      render: (_, inv) =>
        canInvite ? (
          <Popconfirm
            title="Révoquer cette invitation ?"
            okText="Révoquer"
            cancelText="Annuler"
            onConfirm={() => onRevoke(inv.id)}
          >
            <Button size="small" danger type="text" icon={<DeleteOutlined />} />
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 880, margin: "0 auto" }}>
      <Title level={3} style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TeamOutlined /> Utilisateurs
      </Title>
      <Text type="secondary">
        Invitez votre équipe à collaborer dans ce workspace. Chaque membre
        partage les mêmes comptes connectés, publications et automatisations.
      </Text>

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
            placeholder="collegue@exemple.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onPressEnter={onInvite}
          />
          <Select
            style={{ width: 160 }}
            value={roleId}
            options={roleOptions}
            onChange={setRoleId}
            placeholder="Rôle"
          />
          <Button type="primary" loading={inviting} onClick={onInvite}>
            Inviter
          </Button>
        </div>
      )}

      <Table
        rowKey="user_id"
        loading={loading}
        columns={memberCols}
        dataSource={members}
        pagination={false}
        style={{ marginTop: 16 }}
      />

      {invites.length > 0 && (
        <>
          <Title level={5} style={{ marginTop: 32 }}>
            Invitations en attente
          </Title>
          <Table
            rowKey="id"
            columns={inviteCols}
            dataSource={invites}
            pagination={false}
          />
        </>
      )}
    </div>
  );
}
