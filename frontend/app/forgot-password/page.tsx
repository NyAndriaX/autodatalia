"use client";

import { useState } from "react";
import { Form, Input, Button, Alert, Typography } from "antd";
import { MailOutlined } from "@ant-design/icons";
import { authService } from "../lib/authService";

const { Title, Text } = Typography;

export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const onFinish = async (values) => {
    setLoading(true);
    setError("");
    try {
      await authService.forgotPassword({ email: values.email.trim() });
      setSent(true);
    } catch (err) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
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
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Title level={2} style={{ margin: 0, fontWeight: 800, letterSpacing: "-0.02em" }}>
            Reset your password
          </Title>
          <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Enter your email and we&apos;ll send you a reset link.
          </Text>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: 16,
            padding: 32,
            boxShadow: "0 4px 40px rgba(29,63,190,0.08), 0 1px 4px rgba(0,0,0,0.06)",
            border: "1px solid rgba(29,63,190,0.08)",
          }}
        >
          {sent ? (
            <Alert
              type="success"
              showIcon
              title="Check your email"
              description="If that address has an account, a password reset link is on its way. It's valid for one hour."
            />
          ) : (
            <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
              {error && (
                <Alert
                  type="error"
                  showIcon
                  title={error}
                  style={{ marginBottom: 16, borderRadius: 8 }}
                />
              )}
              <Form.Item
                name="email"
                label="Email address"
                rules={[
                  { required: true, message: "Please enter your email" },
                  { type: "email", message: "Please enter a valid email" },
                ]}
              >
                <Input
                  prefix={<MailOutlined />}
                  placeholder="you@datalia.app"
                  autoComplete="email"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                size="large"
                style={{
                  height: 46,
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  background: "linear-gradient(135deg, #1d3fbe, #3b5be3)",
                  border: "none",
                }}
              >
                {loading ? "Sending…" : "Send reset link"}
              </Button>
            </Form>
          )}

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <a href="/" style={{ color: "#1d3fbe", fontSize: 13, fontWeight: 500 }}>
              Back to sign in
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
