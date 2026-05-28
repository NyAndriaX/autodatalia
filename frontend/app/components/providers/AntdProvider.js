"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, theme } from "antd";
import { useEffect, useState } from "react";

const BRAND_TOKEN = {
  colorPrimary: "#1d3fbe",
  colorError: "#dc2626",
  colorWarning: "#f59e0b",
  colorSuccess: "#22c55e",
  colorInfo: "#3b5be3",
  borderRadius: 8,
  borderRadiusLG: 12,
  borderRadiusSM: 6,
  fontFamily:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  lineHeight: 1.6,
  motionDurationMid: "0.2s",
  motionDurationSlow: "0.3s",
};

export default function AntdProvider({ children }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setIsDark(el.getAttribute("data-theme") === "dark");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
          token: BRAND_TOKEN,
          components: {
            Card: {
              borderRadiusLG: 12,
              paddingLG: 20,
            },
            Button: {
              fontWeight: 500,
              borderRadius: 8,
            },
            Input: {
              borderRadius: 8,
            },
            Select: {
              borderRadius: 8,
            },
            Table: {
              borderRadius: 8,
              headerBg: "transparent",
            },
            Statistic: {
              titleFontSize: 12,
            },
            Tabs: {
              borderRadius: 8,
            },
            Alert: {
              borderRadius: 8,
            },
            Form: {
              labelFontSize: 13,
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </AntdRegistry>
  );
}
