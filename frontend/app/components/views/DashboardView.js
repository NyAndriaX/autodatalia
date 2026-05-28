"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { fetchConnections } from "../../lib/oauthService";
import {
  Row,
  Col,
  Card,
  Statistic,
  Button,
  Tag,
  Badge,
  Table,
  Avatar,
  Typography,
  Progress,
  Empty,
  Tooltip,
  Alert,
  Space,
} from "antd";
import {
  ThunderboltOutlined,
  TeamOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  RiseOutlined,
  ArrowRightOutlined,
  ExportOutlined,
  PlusOutlined,
  FacebookOutlined,
  InstagramOutlined,
  LinkedinOutlined,
} from "@ant-design/icons";
import { setActiveView } from "../../store/uiSlice";
import { PLATFORMS, PLATFORM_MAP, STATUS_META, activePlatformIds } from "../../lib/platforms";
import {
  parseDateKey,
  startOfToday,
  isoDateKey,
  addDays,
} from "../../lib/dateUtils";
import { useIsMobile } from "../../lib/useIsMobile";

const { Title, Text } = Typography;

const CREDIT_TO_EUR = 0.01;
const TOKEN_TO_CREDIT_PER_1K = 1;

const fmt = (n) =>
  Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const PLATFORM_TO_PROVIDER = {
  facebook: "meta",
  instagram: "meta",
  tiktok: "tiktok",
  linkedin: "linkedin",
};
const PLATFORM_TO_TARGET_KIND = {
  facebook: "facebook_page",
  instagram: "instagram_business",
  tiktok: "tiktok_account",
  linkedin: "linkedin_member",
};

const PLATFORM_COLORS = {
  facebook: "#1877F2",
  instagram: "#e1306c",
  tiktok: "#010101",
  linkedin: "#0A66C2",
};

const STATUS_CONFIG = {
  published: { color: "cyan", label: "Published" },
  scheduled: { color: "blue", label: "Scheduled" },
  draft: { color: "default", label: "Draft" },
  pending: { color: "gold", label: "Pending" },
  error: { color: "red", label: "Error" },
  approved: { color: "green", label: "Approved" },
  awaiting: { color: "purple", label: "Awaiting" },
  rejected: { color: "default", label: "Rejected" },
};

/* ════════════════════════════════════════
   Main component
════════════════════════════════════════ */
export default function DashboardView() {
  const dispatch = useDispatch();
  const scheduledPosts = useSelector((s) => s.calendar.scheduledPosts);
  const aiUsage = useSelector((s) => s.ui.aiUsage);
  const user = useSelector((s) => s.auth.user);
  const isMobile = useIsMobile();

  const today = startOfToday();
  const todayKey = isoDateKey(today);

  const [oauthState, setOauthState] = useState(null);
  useEffect(() => {
    let alive = true;
    fetchConnections().then((d) => {
      if (alive) setOauthState(d?.providers || {});
    });
    return () => { alive = false; };
  }, []);

  const dateLabel = `${WEEKDAY_LONG[today.getDay()]}, ${MONTH_LONG[today.getMonth()]} ${today.getDate()}`;

  const isConnected = (platformId) =>
    !!oauthState?.[PLATFORM_TO_PROVIDER[platformId]]?.connected;

  const audience = useMemo(() => {
    return PLATFORMS.map((p) => {
      const provider = oauthState?.[PLATFORM_TO_PROVIDER[p.id]];
      const targets = provider?.targets || [];
      const kind = PLATFORM_TO_TARGET_KIND[p.id];
      const matching = targets.filter((t) => t.kind === kind);
      const count = matching.reduce((sum, t) => sum + (t.audience || 0), 0);
      return {
        platform: p.id,
        label: p.label || p.id,
        count,
        connected: !!provider?.connected,
        accountCount: matching.length,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oauthState]);

  const totalAudience = audience.reduce((sum, a) => sum + a.count, 0);

  const stats = useMemo(() => {
    const byStatus = {
      draft: 0, scheduled: 0, pending: 0,
      approved: 0, published: 0, error: 0,
    };
    let thisWeek = 0;
    let publishedThisWeek = 0;
    const weekAheadKey = isoDateKey(addDays(today, 7));
    const weekAgoKey = isoDateKey(addDays(today, -7));
    for (const p of scheduledPosts) {
      if (byStatus[p.status] !== undefined) byStatus[p.status] += 1;
      if (p.status === "scheduled" && p.scheduledDate >= todayKey && p.scheduledDate <= weekAheadKey) {
        thisWeek += 1;
      }
      if (p.status === "published" && p.scheduledDate >= weekAgoKey && p.scheduledDate <= todayKey) {
        publishedThisWeek += 1;
      }
    }
    return { byStatus, thisWeek, publishedThisWeek, total: scheduledPosts.length };
  }, [scheduledPosts, today, todayKey]);

  const creditsSpent = Math.round((aiUsage.totalTokens / 1000) * TOKEN_TO_CREDIT_PER_1K);
  const eurSpent = creditsSpent * CREDIT_TO_EUR;

  const recentPublished = useMemo(() => {
    return scheduledPosts
      .filter((p) => p.status === "published")
      .sort((a, b) => {
        const pa = a.published_at || 0;
        const pb = b.published_at || 0;
        if (pa !== pb) return pb - pa;
        return (b.scheduledDate || "").localeCompare(a.scheduledDate || "");
      })
      .slice(0, 5)
      .map((p, i) => {
        const firstHit = (p.publish_results || []).find((r) => r?.ok && r?.permalink_url);
        return {
          key: p.id || i,
          id: p.id,
          content: p.content,
          platforms: p.platforms || {},
          permalink: firstHit?.permalink_url || null,
          publishedAt: p.published_at || null,
          scheduledDate: p.scheduledDate || null,
          targetLabel: firstHit?.target_label || null,
          status: p.status,
        };
      });
  }, [scheduledPosts]);

  const week = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = addDays(today, i);
      const key = isoDateKey(date);
      const day = scheduledPosts.filter((p) => p.scheduledDate === key);
      return { date, key, day };
    });
  }, [scheduledPosts, today]);

  const connectedCount = PLATFORMS.filter((p) => isConnected(p.id)).length;
  const pagePadding = isMobile ? 12 : 24;

  /* — Table columns for recent posts — */
  const postColumns = [
    {
      title: "Content",
      dataIndex: "content",
      key: "content",
      ellipsis: true,
      render: (text) => (
        <Text style={{ fontSize: 13 }} ellipsis={{ tooltip: text }}>
          {text || <Text type="secondary">(empty)</Text>}
        </Text>
      ),
    },
    {
      title: "Platforms",
      key: "platforms",
      width: 120,
      render: (_, record) => {
        const ids = activePlatformIds(record.platforms);
        return (
          <Space size={4}>
            {ids.slice(0, 3).map((pid) => (
              <Tooltip key={pid} title={pid}>
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 4,
                    background: PLATFORM_COLORS[pid] || "#64748b",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {pid[0].toUpperCase()}
                </span>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: "Date",
      dataIndex: "scheduledDate",
      key: "date",
      width: 100,
      render: (d) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{d || "—"}</Text>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 100,
      render: (status) => {
        const cfg = STATUS_CONFIG[status] || { color: "default", label: status };
        return <Tag color={cfg.color} style={{ fontSize: 11 }}>{cfg.label}</Tag>;
      },
    },
    {
      title: "",
      key: "action",
      width: 48,
      render: (_, record) =>
        record.permalink ? (
          <Tooltip title="View live post">
            <Button
              type="text"
              size="small"
              icon={<ExportOutlined />}
              href={record.permalink}
              target="_blank"
              rel="noopener noreferrer"
            />
          </Tooltip>
        ) : null,
    },
  ];

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ padding: pagePadding, background: "var(--bg-primary)" }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 24, display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <Title level={3} style={{ margin: 0, letterSpacing: "-0.01em" }}>
              Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""} 👋
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {dateLabel} — Here's what's happening with your marketing.
            </Text>
          </div>
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => dispatch(setActiveView("creation"))}
              style={{ borderRadius: 8 }}
            >
              New Post
            </Button>
            <Button
              icon={<CalendarOutlined />}
              onClick={() => dispatch(setActiveView("calendar"))}
              style={{ borderRadius: 8 }}
            >
              Calendar
            </Button>
          </Space>
        </div>

        {/* ── Main KPI row ── */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={12} md={6}>
            <Card
              hoverable
              onClick={() => dispatch(setActiveView("credits"))}
              style={{ cursor: "pointer", borderRadius: 12 }}
              bodyStyle={{ padding: "20px 24px" }}
            >
              <Statistic
                title={
                  <Space size={6}>
                    <ThunderboltOutlined style={{ color: "#1d3fbe" }} />
                    <span>Credits Spent</span>
                    <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>LIVE</Tag>
                  </Space>
                }
                value={fmt(creditsSpent)}
                suffix={<span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>cr.</span>}
                valueStyle={{ fontSize: 28, fontWeight: 800, color: "#1d3fbe" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>≈ €{eurSpent.toFixed(2)} this session</Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card
              hoverable
              onClick={() => dispatch(setActiveView("settings"))}
              style={{ cursor: "pointer", borderRadius: 12 }}
              bodyStyle={{ padding: "20px 24px" }}
            >
              <Statistic
                title={
                  <Space size={6}>
                    <TeamOutlined style={{ color: "#22c55e" }} />
                    <span>Total Audience</span>
                    {connectedCount > 0 && <Tag color="green" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>LIVE</Tag>}
                  </Space>
                }
                value={fmt(totalAudience)}
                valueStyle={{ fontSize: 28, fontWeight: 800, color: "#22c55e" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {connectedCount > 0
                  ? `${connectedCount} platform${connectedCount !== 1 ? "s" : ""} connected`
                  : "Connect platforms in Settings"}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card
              hoverable
              onClick={() => dispatch(setActiveView("calendar"))}
              style={{ cursor: "pointer", borderRadius: 12 }}
              bodyStyle={{ padding: "20px 24px" }}
            >
              <Statistic
                title={
                  <Space size={6}>
                    <CalendarOutlined style={{ color: "#6366f1" }} />
                    <span>Scheduled · 7d</span>
                  </Space>
                }
                value={stats.thisWeek}
                valueStyle={{ fontSize: 28, fontWeight: 800, color: "#6366f1" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {stats.total} posts total in calendar
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card
              hoverable
              onClick={() => dispatch(setActiveView("calendar"))}
              style={{ cursor: "pointer", borderRadius: 12 }}
              bodyStyle={{ padding: "20px 24px" }}
            >
              <Statistic
                title={
                  <Space size={6}>
                    <CheckCircleOutlined style={{ color: "#22c55e" }} />
                    <span>Published · 7d</span>
                  </Space>
                }
                value={stats.publishedThisWeek}
                valueStyle={{ fontSize: 28, fontWeight: 800, color: "#22c55e" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {stats.byStatus.published} published all-time
              </Text>
            </Card>
          </Col>
        </Row>

        {/* ── Secondary stats row ── */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {[
            {
              icon: <ClockCircleOutlined style={{ color: "#f59e0b" }} />,
              label: "Pending Approval",
              value: stats.byStatus.pending,
              sub: `${stats.byStatus.draft} drafts waiting`,
              color: stats.byStatus.pending > 0 ? "#f59e0b" : undefined,
              onClick: () => dispatch(setActiveView("calendar")),
            },
            {
              icon: <ThunderboltOutlined style={{ color: "#1d3fbe" }} />,
              label: "AI Cache Hits",
              value: aiUsage.cacheHits || 0,
              sub: `${aiUsage.calls || 0} real AI calls`,
              color: "#1d3fbe",
              onClick: () => dispatch(setActiveView("analytics")),
            },
            {
              icon: <FileTextOutlined style={{ color: "#64748b" }} />,
              label: "Drafts",
              value: stats.byStatus.draft,
              sub: "awaiting schedule",
              color: "#64748b",
              onClick: () => dispatch(setActiveView("creation")),
            },
            {
              icon: <CloseCircleOutlined style={{ color: "#ef4444" }} />,
              label: "Publish Errors",
              value: stats.byStatus.error,
              sub: "need attention",
              color: stats.byStatus.error > 0 ? "#ef4444" : undefined,
              onClick: stats.byStatus.error > 0 ? () => dispatch(setActiveView("calendar")) : undefined,
            },
          ].map((item) => (
            <Col xs={12} sm={12} md={6} key={item.label}>
              <Card
                hoverable={!!item.onClick}
                onClick={item.onClick}
                style={{
                  cursor: item.onClick ? "pointer" : "default",
                  borderRadius: 12,
                  borderColor: item.color && item.value > 0 ? item.color + "33" : undefined,
                }}
                bodyStyle={{ padding: "16px 20px" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  {item.icon}
                  <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {item.label}
                  </Text>
                </div>
                <div style={{ fontSize: 26, fontWeight: 800, color: item.color || "var(--text-primary)", lineHeight: 1 }}>
                  {item.value}
                </div>
                <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: "block" }}>
                  {item.sub}
                </Text>
              </Card>
            </Col>
          ))}
        </Row>

        {/* ── Alerts ── */}
        {stats.byStatus.error > 0 && (
          <Alert
            type="error"
            showIcon
            message={`${stats.byStatus.error} post${stats.byStatus.error > 1 ? "s" : ""} failed to publish`}
            description="Review these in the Calendar view and retry the publish."
            action={
              <Button size="small" danger onClick={() => dispatch(setActiveView("calendar"))}>
                View errors
              </Button>
            }
            style={{ marginBottom: 24, borderRadius: 10 }}
          />
        )}
        {connectedCount === 0 && (
          <Alert
            type="info"
            showIcon
            message="No social platforms connected"
            description="Connect Facebook, Instagram, TikTok or LinkedIn in Settings to start publishing."
            action={
              <Button size="small" type="primary" onClick={() => dispatch(setActiveView("settings"))}>
                Connect now
              </Button>
            }
            style={{ marginBottom: 24, borderRadius: 10 }}
          />
        )}

        {/* ── 2-col: 7-day calendar + Audience ── */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {/* 7-day mini calendar */}
          <Col xs={24} lg={15}>
            <Card
              title={
                <Space>
                  <CalendarOutlined />
                  <span>Next 7 days</span>
                </Space>
              }
              extra={
                <Button
                  type="link"
                  size="small"
                  icon={<ArrowRightOutlined />}
                  onClick={() => dispatch(setActiveView("calendar"))}
                >
                  Full calendar
                </Button>
              }
              style={{ borderRadius: 12, height: "100%" }}
              bodyStyle={{ padding: 16 }}
            >
              <div style={{ overflowX: isMobile ? "auto" : "visible" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, 1fr)",
                    gap: 8,
                    minWidth: isMobile ? 520 : "auto",
                  }}
                >
                  {week.map(({ date, key, day }) => {
                    const isToday = key === todayKey;
                    return (
                      <button
                        key={key}
                        onClick={() => dispatch(setActiveView("calendar"))}
                        style={{
                          background: isToday ? "rgba(29,63,190,0.06)" : "var(--bg-secondary)",
                          border: `1px solid ${isToday ? "#1d3fbe" : "var(--border-default)"}`,
                          borderRadius: 10,
                          padding: "10px 8px",
                          minHeight: 100,
                          cursor: "pointer",
                          textAlign: "left",
                          transition: "all 0.15s",
                        }}
                      >
                        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: isToday ? "#1d3fbe" : "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
                          {WEEKDAY_SHORT[date.getDay()]}
                        </div>
                        <div style={{ fontSize: 18, fontWeight: 800, color: isToday ? "#1d3fbe" : "var(--text-primary)", lineHeight: 1, marginBottom: 6 }}>
                          {date.getDate()}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {day.slice(0, 2).map((post) => {
                            const s = STATUS_META[post.status] || STATUS_META.draft;
                            return (
                              <div
                                key={post.id}
                                style={{
                                  fontSize: 10,
                                  background: "var(--bg-card)",
                                  borderRadius: 4,
                                  padding: "2px 5px",
                                  color: "var(--text-secondary)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  overflow: "hidden",
                                }}
                                title={post.content}
                              >
                                <span style={{ width: 5, height: 5, borderRadius: "50%", background: s.colorVar, flexShrink: 0 }} />
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                                  {post.content || "(empty)"}
                                </span>
                              </div>
                            );
                          })}
                          {day.length > 2 && (
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                              +{day.length - 2} more
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </Card>
          </Col>

          {/* Audience by platform */}
          <Col xs={24} lg={9}>
            <Card
              title={
                <Space>
                  <TeamOutlined />
                  <span>Audience by Platform</span>
                </Space>
              }
              extra={
                <Button
                  type="link"
                  size="small"
                  icon={<ArrowRightOutlined />}
                  onClick={() => dispatch(setActiveView("settings"))}
                >
                  Manage
                </Button>
              }
              style={{ borderRadius: 12, height: "100%" }}
              bodyStyle={{ padding: 16 }}
            >
              {totalAudience === 0 && connectedCount === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ fontSize: 12 }}>
                      Connect a platform in Settings to see follower data
                    </span>
                  }
                >
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => dispatch(setActiveView("settings"))}
                  >
                    Connect platforms
                  </Button>
                </Empty>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {audience.map((row) => {
                    const maxCount = Math.max(1, ...audience.map((r) => r.count));
                    const pct = Math.round((row.count / maxCount) * 100);
                    const color = PLATFORM_COLORS[row.platform] || "#64748b";
                    return (
                      <div key={row.platform}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                          <Space size={8}>
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: 6,
                                background: color,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                color: "#fff",
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {row.platform[0].toUpperCase()}
                            </span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", textTransform: "capitalize" }}>
                                {row.platform}
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                                {row.connected
                                  ? row.accountCount
                                    ? `${row.accountCount} account${row.accountCount > 1 ? "s" : ""}`
                                    : "Connected"
                                  : "Not connected"}
                              </div>
                            </div>
                          </Space>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>
                              {fmt(row.count)}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-muted)" }}>followers</div>
                          </div>
                        </div>
                        <Progress
                          percent={pct}
                          showInfo={false}
                          strokeColor={color}
                          size="small"
                          style={{ marginBottom: 0 }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </Col>
        </Row>

        {/* ── Recent published posts table ── */}
        <Card
          title={
            <Space>
              <RiseOutlined />
              <span>Recent Published Posts</span>
            </Space>
          }
          extra={
            <Button
              type="link"
              size="small"
              icon={<ArrowRightOutlined />}
              onClick={() => dispatch(setActiveView("calendar"))}
            >
              View all
            </Button>
          }
          style={{ borderRadius: 12, marginBottom: 24 }}
          bodyStyle={{ padding: 0 }}
        >
          {recentPublished.length > 0 ? (
            <Table
              dataSource={recentPublished}
              columns={postColumns}
              pagination={false}
              size="small"
              rowKey="key"
              style={{ borderRadius: "0 0 12px 12px" }}
            />
          ) : (
            <div style={{ padding: 32 }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span style={{ fontSize: 12 }}>
                    No published posts yet. Create and publish content to see it here.
                  </span>
                }
              >
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => dispatch(setActiveView("creation"))}
                >
                  Create first post
                </Button>
              </Empty>
            </div>
          )}
        </Card>

        {/* ── Quick actions ── */}
        <Row gutter={[16, 16]}>
          {[
            {
              title: "Create new post",
              description: "Draft with AI, add media, publish or schedule.",
              icon: <EditIcon />,
              color: "#1d3fbe",
              action: () => dispatch(setActiveView("creation")),
              label: "Open editor",
            },
            {
              title: "Manage automations",
              description: "Set rules to auto-generate and publish content.",
              icon: <RobotIcon />,
              color: "#7c3aed",
              action: () => dispatch(setActiveView("automation")),
              label: "View automations",
            },
            {
              title: "Media library",
              description: "Browse, upload and manage all your assets.",
              icon: <ImageIcon />,
              color: "#0891b2",
              action: () => dispatch(setActiveView("library")),
              label: "Open library",
            },
            {
              title: "Analytics",
              description: "Track AI costs, cache hits and publishing metrics.",
              icon: <ChartIcon />,
              color: "#059669",
              action: () => dispatch(setActiveView("analytics")),
              label: "View analytics",
            },
          ].map((item) => (
            <Col xs={24} sm={12} lg={6} key={item.title}>
              <Card
                hoverable
                onClick={item.action}
                style={{ borderRadius: 12, cursor: "pointer", borderLeft: `3px solid ${item.color}` }}
                bodyStyle={{ padding: 20 }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: item.color + "18",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: item.color,
                      fontSize: 18,
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </div>
                  <div style={{ flex: 1, overflow: "hidden" }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 10 }}>
                      {item.description}
                    </div>
                    <Button type="link" size="small" style={{ padding: 0, fontSize: 12, color: item.color }}>
                      {item.label} →
                    </Button>
                  </div>
                </div>
              </Card>
            </Col>
          ))}
        </Row>

      </div>
    </div>
  );
}

/* ── Tiny inline SVG icons to avoid extra imports ── */
function EditIcon() {
  return <span style={{ fontSize: 18 }}>✏️</span>;
}
function RobotIcon() {
  return <span style={{ fontSize: 18 }}>🤖</span>;
}
function ImageIcon() {
  return <span style={{ fontSize: 18 }}>🖼️</span>;
}
function ChartIcon() {
  return <span style={{ fontSize: 18 }}>📊</span>;
}
