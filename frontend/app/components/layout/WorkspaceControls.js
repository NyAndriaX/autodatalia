"use client";

import { useEffect, useState, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { Dropdown, Popover, Badge, Button, Empty, Input, Modal, message } from "antd";
import {
  AppstoreOutlined,
  MailOutlined,
  CheckOutlined,
  CloseOutlined,
  DownOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useIsMobile } from "../../lib/useIsMobile";
import { restoreSessionThunk } from "../../store/authThunks";
import { loadMessagesThunk } from "../../store/searchThunks";
import { loadScheduledPostsThunk } from "../../store/calendarThunks";
import { clearNotifications } from "../../store/uiSlice";
import {
  fetchMyWorkspaces,
  switchWorkspace,
  createWorkspace,
  fetchMyInvitations,
  acceptInvitation,
  refuseInvitation,
} from "../../lib/workspaceService";
import { invalidateConnectionsCache } from "../../lib/oauthService";

// Topbar controls: switch the active workspace, and accept/refuse invitations
// addressed to you. Both refresh the signed-in user (via /auth/me) after an
// action so the active workspace + permissions update across the whole app.
export default function WorkspaceControls() {
  const dispatch = useDispatch();
  const isMobile = useIsMobile();
  const t = useTranslations("team");
  const user = useSelector((s) => s.auth.user);
  const activeWsId = user?.workspace?.id;

  const [workspaces, setWorkspaces] = useState([]);
  const [invites, setInvites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");

  const loadWorkspaces = useCallback(async () => {
    setWorkspaces(await fetchMyWorkspaces());
  }, []);
  const loadInvites = useCallback(async () => {
    setInvites(await fetchMyInvitations());
  }, []);

  // Re-list workspaces whenever the active one changes (switch / accept).
  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces, activeWsId]);
  useEffect(() => {
    loadInvites();
  }, [loadInvites]);

  // After switching/joining a workspace, re-hydrate everything scoped to it:
  // the user (role + permissions + active workspace), the calendar posts, and
  // the activity feed. Stale cross-workspace notifications are cleared.
  const refreshWorkspaceData = async () => {
    dispatch(clearNotifications());
    // restoreSessionThunk re-points the active-workspace scope (via the auth
    // layer); clear the new workspace's connections cache afterwards so views
    // re-fetch its real connected accounts instead of the previous one's.
    await dispatch(restoreSessionThunk());
    invalidateConnectionsCache();
    dispatch(loadScheduledPostsThunk({ refresh: true }));
    dispatch(loadMessagesThunk());
  };

  const onSwitch = async (id) => {
    if (id === activeWsId || busy) return;
    setBusy(true);
    try {
      await switchWorkspace(id);
      await refreshWorkspaceData();
      message.success(t("workspaceSwitched"));
    } catch (e) {
      message.error(e?.message || t("switchFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onAccept = async (id) => {
    setBusy(true);
    try {
      await acceptInvitation(id);
      await refreshWorkspaceData();
      await Promise.all([loadInvites(), loadWorkspaces()]);
      message.success(t("inviteAccepted"));
    } catch (e) {
      message.error(e?.message || t("acceptFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onRefuse = async (id) => {
    setBusy(true);
    try {
      await refuseInvitation(id);
      await loadInvites();
      message.info(t("inviteRefused"));
    } catch (e) {
      message.error(e?.message || t("refuseFailed"));
    } finally {
      setBusy(false);
    }
  };

  const openCreateModal = () => {
    if (busy) return;
    setWorkspaceName("");
    setCreateOpen(true);
  };

  const closeCreateModal = () => {
    if (busy) return;
    setCreateOpen(false);
    setWorkspaceName("");
  };

  // Create a new workspace (so a user can own more than just their home one).
  const onCreate = async () => {
    if (busy) return;
    const name = workspaceName.trim();
    if (!name) {
      message.warning(t("createWorkspacePrompt"));
      return;
    }
    setBusy(true);
    try {
      await createWorkspace(name);
      await refreshWorkspaceData();
      await loadWorkspaces();
      setCreateOpen(false);
      setWorkspaceName("");
      message.success(t("workspaceCreated"));
    } catch (e) {
      message.error(e?.message || t("createFailed"));
    } finally {
      setBusy(false);
    }
  };

  const activeWs = workspaces.find((w) => w.id === activeWsId);

  const wsMenu = {
    items: [
      {
        key: "__create__",
        icon: <PlusOutlined />,
        label: <strong>{t("createWorkspace")}</strong>,
        onClick: openCreateModal,
      },
      { type: "divider" },
      ...workspaces.map((w) => ({
        key: String(w.id),
        label: (
          <span>
            {w.is_active ? "✓ " : ""}
            {w.name}
            <span style={{ opacity: 0.6, fontSize: 11 }}> · {w.role}</span>
          </span>
        ),
        onClick: () => onSwitch(w.id),
      })),
    ],
  };

  const invitesContent = (
    <div style={{ width: 300, maxHeight: 360, overflowY: "auto" }}>
      {invites.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("noPendingInvites")}
        />
      ) : (
        invites.map((inv) => (
          <div
            key={inv.id}
            style={{
              padding: "10px 4px",
              borderBottom: "1px solid var(--border-default)",
            }}
          >
            <div style={{ fontWeight: 600 }}>{inv.workspace_name}</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
              {t("proposedRole", { role: inv.role_name })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Button
                size="small"
                type="primary"
                icon={<CheckOutlined />}
                loading={busy}
                onClick={() => onAccept(inv.id)}
              >
                {t("accept")}
              </Button>
              <Button
                size="small"
                icon={<CloseOutlined />}
                onClick={() => onRefuse(inv.id)}
              >
                {t("refuse")}
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Dropdown menu={wsMenu} trigger={["click"]} placement="bottomRight">
        <Button size="small" icon={<AppstoreOutlined />}>
          {!isMobile && (
            <span style={{ display: "inline-block", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>
              {activeWs?.name || t("workspace")}
            </span>
          )}
          <DownOutlined style={{ fontSize: 10 }} />
        </Button>
      </Dropdown>

      <Button
        size="small"
        icon={<PlusOutlined />}
        onClick={openCreateModal}
        loading={busy}
        aria-label={t("createWorkspace")}
        title={t("createWorkspace")}
      />

      <Popover
        content={invitesContent}
        trigger="click"
        placement="bottomRight"
        title={t("invitations")}
      >
        <Badge count={invites.length} size="small">
          <Button size="small" icon={<MailOutlined />} aria-label={t("invitations")} />
        </Badge>
      </Popover>

      <Modal
        title={t("createWorkspace")}
        open={createOpen}
        onOk={onCreate}
        onCancel={closeCreateModal}
        okText={t("createWorkspace")}
        confirmLoading={busy}
        destroyOnHidden
      >
        <div style={{ display: "grid", gap: 12 }}>
          <label
            htmlFor="workspace-create-name"
            style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}
          >
            {t("createWorkspacePrompt")}
          </label>
          <Input
            id="workspace-create-name"
            size="large"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            onPressEnter={onCreate}
            placeholder={t("createWorkspacePrompt")}
            autoFocus
            maxLength={120}
          />
        </div>
      </Modal>
    </div>
  );
}
