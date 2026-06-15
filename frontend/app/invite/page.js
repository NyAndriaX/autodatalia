"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Form, Input, Button, Alert, Typography, Spin } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { authService } from "../lib/authService";

const { Title, Text } = Typography;

export default function InvitePage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState(null); // {email, workspace_name, role_name, needs_account}
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Read the token client-side only (avoids the useSearchParams/Suspense
  // `next build` breaker — same pattern as reset-password).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("token") || "";
    setToken(t);
    (async () => {
      const p = await authService.lookupInvite(t);
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
      setError(err?.message || "Cette invitation est invalide ou a expiré.");
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
        message="Invitation invalide"
        description="Ce lien d'invitation est invalide ou a expiré. Demandez une nouvelle invitation à votre administrateur."
        action={
          <Button size="small" onClick={() => router.push("/")}>
            Accueil
          </Button>
        }
      />,
    );
  }

  // Existing account → can't be pulled into a second workspace (MVP). Steer to sign-in.
  if (!preview.needs_account) {
    return wrap(
      <Alert
        type="info"
        showIcon
        message="Vous avez déjà un compte"
        description={`Un compte existe déjà pour ${preview.email}. Connectez-vous pour continuer.`}
        action={
          <Button type="primary" size="small" onClick={() => router.push("/")}>
            Se connecter
          </Button>
        }
      />,
    );
  }

  return wrap(
    <>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>
          Rejoindre {preview.workspace_name || "le workspace"}
        </Title>
        <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
          Vous avez été invité en tant que <b>{preview.role_name}</b> ({preview.email}).
          Créez votre mot de passe pour rejoindre l'équipe.
        </Text>
      </div>

      {error && (
        <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
      )}

      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="name"
          label="Votre nom"
          rules={[{ required: true, message: "Indiquez votre nom." }]}
        >
          <Input prefix={<UserOutlined />} placeholder="Jean Dupont" size="large" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Mot de passe"
          rules={[
            { required: true, message: "Choisissez un mot de passe." },
            { min: 8, message: "8 caractères minimum." },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="••••••••" size="large" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading} block size="large">
          Rejoindre le workspace
        </Button>
      </Form>
    </>,
  );
}
