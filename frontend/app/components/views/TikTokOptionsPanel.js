"use client";

import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslations } from "next-intl";
import { Music, UserCheck } from "lucide-react";
import { fetchConnections } from "../../lib/oauthService";
import { setTiktokOptions } from "../../store/editorSlice";

export default function TikTokOptionsPanel() {
  const t = useTranslations("tiktokOptions");
  const dispatch = useDispatch();
  const tiktok = useSelector((s) => s.editor.currentPost.tiktok || {});
  const [providers, setProviders] = useState(null);

  const TIKTOK_PRIVACY_LEVELS = [
    { value: "PUBLIC_TO_EVERYONE", label: t("visibilityPublic") },
    { value: "MUTUAL_FOLLOW_FRIENDS", label: t("visibilityFriends") },
    { value: "FOLLOWER_OF_CREATOR", label: t("visibilityFollowers") },
    { value: "SELF_ONLY", label: t("visibilitySelf") },
  ];

  useEffect(() => {
    let cancelled = false;
    fetchConnections().then((d) => {
      if (cancelled) return;
      setProviders(d?.providers || {});
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tiktokTarget = (providers?.tiktok?.targets || [])[0];
  const setTk = (patch) => dispatch(setTiktokOptions(patch));

  return (
    <div
      className="rounded-lg p-3 space-y-3"
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-default)",
      }}
    >
      <p
        className="text-[10px] uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}
      >
        {t("title")}
      </p>

      {/* Creator card */}
      <div className="flex items-center gap-2">
        {tiktokTarget?.profile_picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tiktokTarget.profile_picture_url}
            alt={tiktokTarget?.label || "TikTok creator"}
            className="w-8 h-8 rounded-full"
            style={{ objectFit: "cover", border: "1px solid var(--border-default)" }}
          />
        ) : (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center"
            style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
          >
            <UserCheck size={14} />
          </div>
        )}
        <div className="flex flex-col">
          <span
            className="text-xs font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {tiktokTarget?.display_name || t("connectAccount")}
          </span>
          <span
            className="text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {t("publishingAs")} {tiktokTarget?.label || "—"}
          </span>
        </div>
      </div>

      {/* Visibility */}
      <label className="block">
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          {t("visibility")}
        </span>
        <select
          value={tiktok.privacy_level || "SELF_ONLY"}
          onChange={(e) => setTk({ privacy_level: e.target.value })}
          className="mt-1 w-full text-xs rounded-md px-2 py-1.5"
          style={{
            background: "var(--bg-card)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-default)",
          }}
        >
          {TIKTOK_PRIVACY_LEVELS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      {/* Branded content */}
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={!!tiktok.disclose_video_branded}
          onChange={(e) => setTk({ disclose_video_branded: e.target.checked })}
          className="mt-0.5"
        />
        <span style={{ color: "var(--text-primary)" }}>
          {t("brandedContent")}
          <span
            className="block text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {t("brandedContentDescription")}
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={!!tiktok.disclose_video_your_brand}
          onChange={(e) => setTk({ disclose_video_your_brand: e.target.checked })}
          className="mt-0.5"
        />
        <span style={{ color: "var(--text-primary)" }}>
          {t("yourBrand")}
          <span
            className="block text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {t("yourBrandDescription")}
          </span>
        </span>
      </label>

      {/* Music gate */}
      <label
        className="flex items-start gap-2 text-xs cursor-pointer rounded-md px-2 py-2"
        style={{
          background: tiktok.music_confirmed
            ? "rgba(34,197,94,0.10)"
            : "rgba(234,179,8,0.10)",
          border: `1px solid ${
            tiktok.music_confirmed
              ? "rgba(34,197,94,0.4)"
              : "rgba(234,179,8,0.4)"
          }`,
        }}
      >
        <Music
          size={13}
          style={{
            color: tiktok.music_confirmed ? "#22c55e" : "#eab308",
            marginTop: 2,
          }}
        />
        <input
          type="checkbox"
          checked={!!tiktok.music_confirmed}
          onChange={(e) => setTk({ music_confirmed: e.target.checked })}
          className="mt-0.5"
        />
        <span style={{ color: "var(--text-primary)" }}>
          {t("musicConsent")}
          <span
            className="block text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            {t("musicConsentRequired")}
          </span>
        </span>
      </label>
    </div>
  );
}
