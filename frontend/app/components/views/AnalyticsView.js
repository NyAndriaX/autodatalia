"use client";

import { useSelector, useDispatch } from "react-redux";
import {
  Row,
  Col,
  Card,
  Statistic,
  Button,
  Table,
  Tag,
  Progress,
  Alert,
  Space,
  Typography,
  Tooltip,
  Badge,
} from "antd";
import {
  ThunderboltOutlined,
  RiseOutlined,
  DatabaseOutlined,
  DollarOutlined,
  RotateLeftOutlined,
  InfoCircleOutlined,
  BarChartOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { resetTokenUsage } from "../../store/uiSlice";
import { fetchCostSummary } from "../../lib/costService";

const { Title, Text } = Typography;

function buildHourlyBuckets(calls, bucketCount = 7) {
  if (!calls.length) {
    return Array.from({ length: bucketCount }, (_, i) => ({
      label: `${i + 1}h`,
      calls: 0,
      tokens: 0,
    }));
  }
  const now = Date.now();
  const bucketMs = 60 * 60 * 1000;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: i === 0 ? "now" : `-${i}h`,
    calls: 0,
    tokens: 0,
  }));
  for (const c of calls) {
    const offsetHours = Math.floor((now - c.at) / bucketMs);
    if (offsetHours >= 0 && offsetHours < bucketCount) {
      buckets[offsetHours].calls += 1;
      buckets[offsetHours].tokens += c.totalTokens || 0;
    }
  }
  return buckets.reverse();
}

function rollupByModel(calls) {
  const byModel = new Map();
  for (const c of calls) {
    const key = c.model || "llm-router";
    const row = byModel.get(key) || { model: key, calls: 0, tokens: 0 };
    row.calls += 1;
    row.tokens += c.totalTokens || 0;
    byModel.set(key, row);
  }
  return [...byModel.values()].sort((a, b) => b.tokens - a.tokens);
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function AnalyticsView() {
  const dispatch = useDispatch();
  const t = useTranslations("analytics");
  const tCommon = useTranslations("common");
  const aiUsage = useSelector((s) => s.ui.aiUsage);
  const calls = useMemo(() => aiUsage.recentCalls || [], [aiUsage.recentCalls]);

  const MOCK_KPIS = [
    { label: t("postsPublished"), value: "128", delta: "+12%", positive: true },
    { label: t("avgEngagement"), value: "4.7%", delta: "+0.6pt", positive: true },
    { label: t("reach"), value: "82.4k", delta: "+9%", positive: true },
    { label: t("llmCost30d"), value: "$37.10", delta: "-4%", positive: false },
  ];

  const buckets = useMemo(() => buildHourlyBuckets(calls), [calls]);
  const maxBar = useMemo(() => Math.max(1, ...buckets.map((b) => b.calls)), [buckets]);
  const byModel = useMemo(() => rollupByModel(calls), [calls]);

  // Server-side cost summary (30-day rolling) — replaces the four
  // MOCK_KPIs the dashboard used to show. The Coins / 30d count / spend
  // numbers below are the real per-workspace figures.
  const [serverSummary, setServerSummary] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await fetchCostSummary("30d");
        if (!cancelled) setServerSummary(data);
      } catch {
        /* leave summary null; the cards fall back gracefully */
      }
    }
    load();
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const hasRealData = calls.length > 0 || (aiUsage.cacheHits || 0) > 0;
  const sessionTokens = aiUsage.totalTokens || 0;
  const sessionCalls = aiUsage.calls || 0;
  const cacheHits = aiUsage.cacheHits || 0;
  const totalRequests = sessionCalls + cacheHits;
  const cacheHitRate = totalRequests ? Math.round((cacheHits / totalRequests) * 100) : 0;
  const avgPerCall = sessionCalls ? Math.round(sessionTokens / sessionCalls) : 0;

  /* Model table columns */
  const modelColumns = [
    {
      title: t("model"),
      dataIndex: "model",
      key: "model",
      render: (m) => (
        <Text strong style={{ fontSize: 12 }}>{m}</Text>
      ),
    },
    {
      title: t("calls"),
      dataIndex: "calls",
      key: "calls",
      width: 70,
      render: (v) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: t("tokens"),
      dataIndex: "tokens",
      key: "tokens",
      width: 100,
      align: "right",
      render: (v) => {
        const pct = byModel[0]?.tokens ? Math.round((v / byModel[0].tokens) * 100) : 0;
        return (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{formatTokens(v)}</div>
            <Progress
              percent={pct}
              showInfo={false}
              size="small"
              strokeColor="#1d3fbe"
              style={{ margin: 0, minWidth: 60 }}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ padding: 24, background: "var(--bg-primary)" }}
    >

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
          <div>
            <Title level={3} style={{ margin: 0, letterSpacing: "-0.01em" }}>
              {t("titleFull")}
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {t("subtitle")}
            </Text>
          </div>
          {hasRealData && (
            <Button
              icon={<RotateLeftOutlined />}
              onClick={() => dispatch(resetTokenUsage())}
              size="small"
            >
              {t("reset")}
            </Button>
          )}
        </div>

        {/* Live session banner */}
        <Alert
          type={hasRealData ? "success" : "info"}
          showIcon
          icon={<ThunderboltOutlined />}
          message={
            <span>
              {t("sessionTokens", { n: sessionTokens.toLocaleString(), calls: sessionCalls })}
            </span>
          }
          style={{ marginBottom: 24, borderRadius: 10 }}
        />

        {/* Live KPI row */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <ThunderboltOutlined style={{ color: "#1d3fbe" }} />
                    <span>{t("tokensSession")}</span>
                    <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>{t("liveBadge")}</Tag>
                  </Space>
                }
                value={formatTokens(sessionTokens)}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#1d3fbe" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("realCalls", { n: sessionCalls })}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <RiseOutlined style={{ color: "#22c55e" }} />
                    <span>{t("avgPerCall")}</span>
                  </Space>
                }
                value={avgPerCall ? formatTokens(avgPerCall) : "—"}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#22c55e" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {hasRealData ? t("sessionAvg") : t("noCallsYet")}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <DatabaseOutlined style={{ color: "#7c3aed" }} />
                    <span>{t("modelsUsed")}</span>
                  </Space>
                }
                value={byModel.length || "—"}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#7c3aed" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {byModel[0]?.model || t("noCallsYet")}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <DollarOutlined style={{ color: "#f59e0b" }} />
                    <span>{t("cacheHitRate")}</span>
                    <Tooltip title={t("cacheHitTooltip")}>
                      <InfoCircleOutlined style={{ color: "var(--text-muted)", fontSize: 11 }} />
                    </Tooltip>
                  </Space>
                }
                value={totalRequests ? `${cacheHitRate}%` : "—"}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#f59e0b" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("hitsPaid", { hits: cacheHits, paid: sessionCalls })}
              </Text>
            </Card>
          </Col>
        </Row>

        {/* Bar chart + Model table */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {/* Hourly bar chart */}
          <Col xs={24} lg={14}>
            <Card
              title={
                <Space>
                  <BarChartOutlined />
                  <span>{t("llmCalls7h")}</span>
                  <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>{t("liveBadge")}</Tag>
                </Space>
              }
              style={{ borderRadius: 12 }}
              bodyStyle={{ padding: "20px 24px" }}
            >
              {hasRealData ? (
                <div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160, marginBottom: 8 }}>
                    {buckets.map((b, idx) => (
                      <Tooltip
                        key={idx}
                        title={t("bucketTooltip", { calls: b.calls, tokens: formatTokens(b.tokens) })}
                      >
                        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, cursor: "default" }}>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            {b.calls > 0 ? b.calls : ""}
                          </span>
                          <div
                            style={{
                              width: "100%",
                              borderRadius: "4px 4px 0 0",
                              background: b.calls > 0
                                ? "linear-gradient(180deg, #3b5be3, #1d3fbe)"
                                : "var(--bg-secondary)",
                              height: `${Math.max(4, (b.calls / maxBar) * 130)}px`,
                              minHeight: 4,
                              transition: "height 0.3s ease",
                            }}
                          />
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {buckets.map((b, idx) => (
                      <div key={idx} style={{ flex: 1, textAlign: "center" }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{b.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                  <BarChartOutlined style={{ fontSize: 32, color: "var(--text-muted)", opacity: 0.4 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("emptyChart")}
                  </Text>
                </div>
              )}
            </Card>
          </Col>

          {/* Tokens utilisés par modèle */}
          <Col xs={24} lg={10}>
            <Card
              title={
                <Space>
                  <DatabaseOutlined />
                  <span>{t("tokenByModel")}</span>
                  <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>{t("liveBadge")}</Tag>
                </Space>
              }
              style={{ borderRadius: 12 }}
              bodyStyle={{ padding: 0 }}
            >
              {hasRealData ? (
                <Table
                  dataSource={byModel.map((r, i) => ({ ...r, key: i }))}
                  columns={modelColumns}
                  pagination={false}
                  size="small"
                />
              ) : (
                <div style={{ padding: 32, textAlign: "center" }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t("emptyTable")}
                  </Text>
                </div>
              )}
            </Card>
          </Col>
        </Row>

        {/* Server-tracked 30-day rolling cost (from /costs/summary) */}
        <div style={{ marginBottom: 12, marginTop: 8 }}>
          <Space>
            <DollarOutlined style={{ color: "#f59e0b" }} />
            <Text style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600, color: "var(--text-secondary)" }}>
              {t("serverTracked")}
            </Text>
            {serverSummary && (
              <Tag color="gold" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>{t("liveBadge")}</Tag>
            )}
          </Space>
        </div>
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {[
            {
              label: t("spend30d"),
              value: serverSummary?.totals ? `€${(serverSummary.totals.cost_eur || 0).toFixed(2)}` : "—",
              sub: serverSummary?.totals ? `$${(serverSummary.totals.cost_usd || 0).toFixed(2)} USD` : tCommon("loading"),
              color: "#f59e0b",
            },
            {
              label: t("realCalls30d"),
              value: serverSummary?.totals ? (serverSummary.totals.calls || 0).toLocaleString() : "—",
              sub: serverSummary?.totals ? t("cacheHitsCount", { n: serverSummary.totals.cache_hits || 0 }) : "—",
              color: "#1d3fbe",
            },
            {
              label: t("tokens30d"),
              value: serverSummary?.totals ? formatTokens(serverSummary.totals.tokens || 0) : "—",
              sub: serverSummary?.totals?.saved_by_cache_usd
                ? t("savedByCache", { tokens: formatTokens(Math.round((serverSummary.totals.saved_by_cache_usd / 0.001) * 1000)) })
                : "—",
              color: "#7c3aed",
            },
            {
              label: t("topWorkflow"),
              value: serverSummary?.by_workflow?.[0]?.key || "—",
              sub: serverSummary?.by_workflow?.[0]
                ? `$${serverSummary.by_workflow[0].cost_usd.toFixed(3)}`
                : t("noSpendYet"),
              color: "#059669",
            },
          ].map((item) => (
            <Col xs={12} sm={12} md={6} key={item.label}>
              <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "18px 20px" }}>
                <Statistic
                  title={item.label}
                  value={item.value}
                  valueStyle={{ fontSize: 22, fontWeight: 800, color: item.color }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>{item.sub}</Text>
              </Card>
            </Col>
          ))}
        </Row>

        {/* Sample data section — clearly labeled */}
        <div style={{ marginBottom: 12 }}>
          <Space>
            <InfoCircleOutlined style={{ color: "var(--text-muted)" }} />
            <Text type="secondary" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              {t("sampleData")}
            </Text>
          </Space>
        </div>

        <Row gutter={[16, 16]}>
          {MOCK_KPIS.map((k) => (
            <Col xs={12} sm={12} md={6} key={k.label}>
              <Card
                style={{ borderRadius: 12, opacity: 0.85 }}
                bodyStyle={{ padding: "20px 24px" }}
              >
                <Statistic
                  title={k.label}
                  value={k.value}
                  valueStyle={{ fontSize: 24, fontWeight: 800 }}
                />
                <Tag
                  color={k.positive ? "green" : "red"}
                  style={{ marginTop: 8, fontSize: 11 }}
                >
                  {k.delta}
                </Tag>
              </Card>
            </Col>
          ))}
        </Row>

    </div>
  );
}
