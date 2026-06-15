"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Form, Input, Button, Alert, Typography, Spin } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { authService } from "../lib/authService";

const { Title, Text } = Typography;

export default function InvitePage() {
  const router = useRouter();
  const t = useTranslations("team");
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState(null); // {email, workspace_name, role_name, needs_account}
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Read the token client-side only (avoids the useSearchParams/Suspense
  // `next build` breaker — same pattern as reset-password).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get("token") || "";
    setToken(tok);
    (async () => {
      const p = await authService.lookupInvite(tok);
      setPreview(p);
      setChecking(false);
    })();
  }, []);

  const onFinish = async (values) => {
    setLoading(true);
    setError("");
    try {
      await authService.acceptInvite({
        token,
        name: values.name,
        password: values.password,
      });
      router.push("/dashboard");
    } catch (err) {
      setError(err?.message || t("inviteInvalidExpired"));
    } finally {
      setLoading(false);
    }
  };

  const wrap = (children) => (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f8faff",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
    </div>
  );

  if (checking) {
    return wrap(
      <div style={{ textAlign: "center" }}>
        <Spin />
      </div>,
    );
  }

  if (!preview) {
    return wrap(
      <Alert
        type="error"
        showIcon
        message={t("invalidInviteTitle")}
        description={t("invalidInviteDesc")}
        action={
          <Button size="small" onClick={() => router.push("/")}>
            {t("home")}
          </Button>
        }
      />,
    );
  }

  // Existing account → can't be pulled into a second workspace via the link.
  if (!preview.needs_account) {
    return wrap(
      <Alert
        type="info"
        showIcon
        message={t("alreadyAccountTitle")}
        description={t("alreadyAccountDesc", { email: preview.email })}
        action={
          <Button type="primary" size="small" onClick={() => router.push("/")}>
            {t("signIn")}
          </Button>
        }
      />,
    );
  }

  return wrap(
    <>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>
          {t("joinWorkspace", { workspace: preview.workspace_name || t("workspace") })}
        </Title>
        <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          {t("invitedAs", { role: preview.role_name, email: preview.email })}
        </Text>
      </div>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      )}

      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="name"
          label={t("yourName")}
          rules={[{ required: true, message: t("nameRequired") }]}
        >
          <Input prefix={<UserOutlined />} placeholder={t("namePlaceholder")} size="large" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t("password")}
          rules={[
            { required: true, message: t("passwordRequired") },
            { min: 8, message: t("passwordMin") },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          {t("joinButton")}
        </Button>
      </Form>
    </>,
  );
}
