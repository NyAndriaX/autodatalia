"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Form, Input, Button, Alert, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { authService } from "../lib/authService";
import { useQueryParam } from "../lib/useQueryParam";

const { Title, Text } = Typography;

export default function ResetPasswordPage() {
  const router = useRouter();
  // Read the token from the URL on the client only — avoids needing a
  // <Suspense> boundary around useSearchParams (which breaks `next build`).
  const token = useQueryParam("token");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const onFinish = async (values) => {
    setLoading(true);
    setError("");
    try {
      await authService.resetPassword({ token, newPassword: values.password });
      setDone(true);
      setTimeout(() => router.push("/"), 1500);
    } catch (err) {
      setError(err?.message || "This reset link is invalid or has expired.");
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
            Choose a new password
          </Title>
          <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Enter a new password for your account.
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
          {done ? (
            <Alert
              type="success"
              showIcon
              message="Password updated"
              description="You're signed in. Redirecting…"
            />
          ) : (
            <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
              {error && (
                <Alert
                  type="error"
                  showIcon
                  message={error}
                  style={{ marginBottom: 16, borderRadius: 8 }}
                />
              )}
              <Form.Item
                name="password"
                label="New password"
                rules={[
                  { required: true, message: "Please enter a password" },
                  { min: 6, message: "Password must be at least 6 characters" },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Form.Item
                name="confirm"
                label="Confirm new password"
                dependencies={["password"]}
                rules={[
                  { required: true, message: "Please confirm your password" },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue("password") === value) {
                        return Promise.resolve();
                      }
                      return Promise.reject(new Error("Passwords do not match"));
                    },
                  }),
                ]}
                style={{ marginBottom: 24 }}
              >
                <Input.Password
                  prefix={<LockOutlined />}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  style={{ borderRadius: 8, height: 44 }}
                />
              </Form.Item>

              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                disabled={!token}
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
                {loading ? "Updating…" : "Update password"}
              </Button>
              {!token && (
                <Text
                  type="secondary"
                  style={{ display: "block", marginTop: 12, fontSize: 12, textAlign: "center" }}
                >
                  This page needs a valid reset link from your email.
                </Text>
              )}
            </Form>
          )}

          <div style={{ textAlign: "center", marginTop: 20 }}>
            <Link href="/" style={{ color: "#1d3fbe", fontSize: 13, fontWeight: 500 }}>
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
