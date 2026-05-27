"use client";

import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Music, UserCheck } from "lucide-react";
import { fetchConnections } from "../../lib/oauthService";
import { setTiktokOptions } from "../../store/editorSlice";

const TIKTOK_PRIVACY_LEVELS = [
  { value: "PUBLIC_TO_EVERYONE", label: "Public — everyone" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Mutual followers only" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers only" },
  { value: "SELF_ONLY", label: "Only me" },
];

export default function TikTokOptionsPanel() {
  const dispatch = useDispatch();
  const tiktok = useSelector((s) => s.editor.currentPost.tiktok || {});
  const [providers, setProviders] = useState(null);

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
        TikTok options
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
            {tiktokTarget?.display_name || "Connect a TikTok account"}
          </span>
          <span
            className="text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            Publishing as {tiktokTarget?.label || "—"}
          </span>
        </div>
      </div>

      {/* Visibility */}
      <label className="block">
        <span
          className="text-[10px] uppercase tracking-wider"
          style={{ color: "var(--text-muted)" }}
        >
          Who can view
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
          Disclose branded content
          <span
            className="block text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            Promotes a third-party brand, product, or service.
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
          Your brand
          <span
            className="block text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            Promotes yourself, your business, or your product.
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
          I confirm the music used in this video does not violate any third-party rights.
          <span
            className="block text-[10px]"
            style={{ color: "var(--text-muted)" }}
          >
            Required by TikTok before publishing.
          </span>
        </span>
      </label>
    </div>
  );
}
