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
import { resetTokenUsage } from "../../store/uiSlice";
import { fetchCostSummary } from "../../lib/costService";

const { Title, Text } = Typography;

const MOCK_KPIS = [
  { label: "Posts publiés (30j)", value: "128", delta: "+12%", positive: true },
  { label: "Engagement moyen", value: "4.7%", delta: "+0.6pt", positive: true },
  { label: "Portée", value: "82.4k", delta: "+9%", positive: true },
  { label: "Coût LLM (30j)", value: "$37.10", delta: "-4%", positive: false },
];

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
  const aiUsage = useSelector((s) => s.ui.aiUsage);
  const calls = useMemo(() => aiUsage.recentCalls || [], [aiUsage.recentCalls]);

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
      title: "Model",
      dataIndex: "model",
      key: "model",
      render: (m) => (
        <Text strong style={{ fontSize: 12 }}>{m}</Text>
      ),
    },
    {
      title: "Calls",
      dataIndex: "calls",
      key: "calls",
      width: 70,
      render: (v) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: "Tokens",
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
              Analytiques & Coûts IA
            </Title>
            <Text type="secondary" style={{ fontSize: 13 }}>
              Utilisation IA en direct et performances des publications.
            </Text>
          </div>
          {hasRealData && (
            <Button
              icon={<RotateLeftOutlined />}
              onClick={() => dispatch(resetTokenUsage())}
              size="small"
            >
              Réinitialiser
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
              <strong>{sessionTokens.toLocaleString()} tokens</strong> across{" "}
              <strong>{sessionCalls}</strong> appel IA réel{sessionCalls !== 1 ? "s" : ""} this session.
              Les hits de cache ne consomment pas de tokens.
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
                    <span>Tokens (session)</span>
                    <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>LIVE</Tag>
                  </Space>
                }
                value={formatTokens(sessionTokens)}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#1d3fbe" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {sessionCalls} real call{sessionCalls !== 1 ? "s" : ""}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <RiseOutlined style={{ color: "#22c55e" }} />
                    <span>Avg / call</span>
                  </Space>
                }
                value={avgPerCall ? formatTokens(avgPerCall) : "—"}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#22c55e" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {hasRealData ? "session avg" : "no calls yet"}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <DatabaseOutlined style={{ color: "#7c3aed" }} />
                    <span>Modèles utilisés</span>
                  </Space>
                }
                value={byModel.length || "—"}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#7c3aed" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {byModel[0]?.model || "no calls yet"}
              </Text>
            </Card>
          </Col>

          <Col xs={12} sm={12} md={6}>
            <Card style={{ borderRadius: 12 }} bodyStyle={{ padding: "20px 24px" }}>
              <Statistic
                title={
                  <Space size={6}>
                    <DollarOutlined style={{ color: "#f59e0b" }} />
                    <span>Cache hit rate</span>
                    <Tooltip title="Cache hits avoid appel IA réels and cost 0 tokens.">
                      <InfoCircleOutlined style={{ color: "var(--text-muted)", fontSize: 11 }} />
                    </Tooltip>
                  </Space>
                }
                value={totalRequests ? `${cacheHitRate}%` : "—"}
                valueStyle={{ fontSize: 26, fontWeight: 800, color: "#f59e0b" }}
              />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {cacheHits} hit{cacheHits !== 1 ? "s" : ""} · {sessionCalls} paid
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
                  <span>LLM calls — last 7 hours</span>
                  <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>LIVE</Tag>
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
                        title={`${b.calls} call${b.calls !== 1 ? "s" : ""} · ${formatTokens(b.tokens)} tokens`}
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
                    Generate a post to start collecting session data.
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
                  <span>Tokens utilisés par modèle</span>
                  <Tag color="blue" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>LIVE</Tag>
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
                    No AI calls yet this session.
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
              Server-tracked · last 30 days
            </Text>
            {serverSummary && (
              <Tag color="gold" style={{ fontSize: 9, lineHeight: "16px", padding: "0 4px" }}>LIVE</Tag>
            )}
          </Space>
        </div>
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {[
            {
              label: "LLM + media spend",
              value: serverSummary?.totals ? `€${(serverSummary.totals.cost_eur || 0).toFixed(2)}` : "—",
              sub: serverSummary?.totals ? `$${(serverSummary.totals.cost_usd || 0).toFixed(2)} USD` : "loading…",
              color: "#f59e0b",
            },
            {
              label: "Real AI calls (30d)",
              value: serverSummary?.totals ? (serverSummary.totals.calls || 0).toLocaleString() : "—",
              sub: serverSummary?.totals ? `${serverSummary.totals.cache_hits || 0} cache hits` : "—",
              color: "#1d3fbe",
            },
            {
              label: "Tokens (30d)",
              value: serverSummary?.totals ? formatTokens(serverSummary.totals.tokens || 0) : "—",
              sub: serverSummary?.totals?.saved_by_cache_usd
                ? `${formatTokens(Math.round((serverSummary.totals.saved_by_cache_usd / 0.001) * 1000))} saved by cache`
                : "—",
              color: "#7c3aed",
            },
            {
              label: "Top workflow",
              value: serverSummary?.by_workflow?.[0]?.key || "—",
              sub: serverSummary?.by_workflow?.[0]
                ? `$${serverSummary.by_workflow[0].cost_usd.toFixed(3)}`
                : "no spend yet",
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
              Sample data — engagement records not yet wired
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
