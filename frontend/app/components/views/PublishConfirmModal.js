"use client";

import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, Send, AlertTriangle, Music, UserCheck } from "lucide-react";
import { fetchConnections } from "../../lib/oauthService";
import { PLATFORMS } from "../../lib/platforms";
import { setTiktokOptions } from "../../store/editorSlice";

const PLATFORM_TO_PROVIDER = {
  facebook: "meta",
  instagram: "meta",
  tiktok: "tiktok",
  linkedin: "linkedin",
};

const PLATFORM_TARGET_KIND = {
  facebook: "facebook_page",
  instagram: "instagram_business",
  tiktok: "tiktok_account",
};

/* TikTok privacy levels in the order the audit reviewer will see them.
   Sandbox-mode publishes are forced to SELF_ONLY regardless of choice
   here, but the audit checks the UI exposes the full set — so we render
   them all and let the user pick. */
const TIKTOK_PRIVACY_LEVELS = [
  { value: "PUBLIC_TO_EVERYONE", label: "Public — everyone" },
  { value: "MUTUAL_FOLLOW_FRIENDS", label: "Mutual followers only" },
  { value: "FOLLOWER_OF_CREATOR", label: "Followers only" },
  { value: "SELF_ONLY", label: "Only me" },
];

/**
 * Last-mile confirmation before publish. Shows the post content, the
 * exact target accounts, and a warning if the user just published the
 * same thing. Cancels return the user to the editor; confirms invoke
 * the publish thunk.
 *
 * The backend also enforces a cooldown + duplicate guard, so this is
 * defense-in-depth: the modal stops the easy "double-click → double
 * post" case before any HTTP round-trip.
 */
export default function PublishConfirmModal({
  content,
  enabledPlatforms,
  recentPostHashes,
  contentHash,
  onClose,
  onConfirm,
}) {
  const dispatch = useDispatch();
  const tiktok = useSelector((s) => s.editor.currentPost.tiktok || {});
  const [providers, setProviders] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchConnections().then((d) => {
      if (cancelled) return;
      setProviders(d?.providers || {});
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tiktokEnabled = enabledPlatforms.includes("tiktok");
  // Pull the connected TikTok target for the creator card. There's only
  // one per app (TikTok caps the OAuth flow at one account at a time).
  const tiktokTarget = (providers?.tiktok?.targets || [])[0];
  // Gate the Publish button — TikTok's audit requires the user to
  // explicitly confirm music rights before the post can fire. Mirrors
  // what the demo videos need to show.
  const tiktokGateOk = !tiktokEnabled || !!tiktok.music_confirmed;

  const setTk = (patch) => dispatch(setTiktokOptions(patch));

  const targetsByPlatform = enabledPlatforms.map((id) => {
    const provider = providers?.[PLATFORM_TO_PROVIDER[id]];
    const wantKind = PLATFORM_TARGET_KIND[id];
    const ts = (provider?.targets || []).filter(
      (t) => !wantKind || t.kind === wantKind
    );
    return { platformId: id, targets: ts };
  });

  const totalTargets = targetsByPlatform.reduce((n, p) => n + p.targets.length, 0);
  const isDuplicate = !!(contentHash && recentPostHashes?.has?.(contentHash));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm publish"
    >
      <div
        className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          boxShadow: "0 24px 48px rgba(15,23,42,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--border-default)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            Confirm publish
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md"
            style={{ color: "var(--text-secondary)" }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {/* Duplicate warning — surfaces a frontend-only hint before the
              backend would reject the same content. */}
          {isDuplicate && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
              style={{
                background: "rgba(234,179,8,0.12)",
                color: "var(--text-primary)",
                border: "1px solid rgba(234,179,8,0.4)",
              }}
            >
              <AlertTriangle size={14} style={{ color: "#eab308" }} className="shrink-0 mt-0.5" />
              <span>
                You posted this same content recently — confirming again will publish a duplicate.
              </span>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Content
            </p>
            <div
              className="text-xs whitespace-pre-wrap max-h-24 overflow-y-auto px-3 py-2 rounded-md"
              style={{ background: "var(--bg-secondary)", color: "var(--text-primary)" }}
            >
              {content || <em style={{ color: "var(--text-muted)" }}>(empty — media only)</em>}
            </div>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Posting to ({totalTargets})
            </p>
            {loading ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>Loading connected accounts…</p>
            ) : totalTargets === 0 ? (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                No connected accounts for the selected platforms.
              </p>
            ) : (
              <ul className="space-y-1">
                {targetsByPlatform.flatMap(({ platformId, targets }) =>
                  targets.map((t) => {
                    const platform = PLATFORMS.find((p) => p.id === platformId);
                    return (
                      <li
                        key={`${platformId}-${t.id}`}
                        className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md"
                        style={{ background: "var(--bg-secondary)" }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: platform?.color || "var(--accent-primary)" }}
                          aria-hidden="true"
                        />
                        <span style={{ color: "var(--text-secondary)" }}>{platform?.label || platformId}</span>
                        <span style={{ color: "var(--text-muted)" }}>·</span>
                        <span style={{ color: "var(--text-primary)" }}>{t.label}</span>
                      </li>
                    );
                  })
                )}
              </ul>
            )}
          </div>

          {/* TikTok compose section. Renders only when TikTok is in the
              publish set. Every element here is reject-on-sight if missing
              from the audit demo videos:
              - creator avatar + @handle BEFORE the publish button
              - visibility selector
              - branded-content toggles (TikTok wants TWO: "branded" + "your brand")
              - music-usage confirmation that gates Publish. */}
          {tiktokEnabled && (
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

              {/* Creator card — avatar + handle pulled from the OAuth
                  user_info we now persist on token exchange. */}
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
                  value={tiktok.privacy_level || "PUBLIC_TO_EVERYONE"}
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

              {/* Branded content — two separate toggles per TikTok's UI rule */}
              <label className="flex items-start gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!tiktok.disclose_video_branded}
                  onChange={(e) =>
                    setTk({ disclose_video_branded: e.target.checked })
                  }
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
                  onChange={(e) =>
                    setTk({ disclose_video_your_brand: e.target.checked })
                  }
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

              {/* Music gate — Publish disabled until ticked */}
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
                  onChange={(e) =>
                    setTk({ music_confirmed: e.target.checked })
                  }
                  className="mt-0.5"
                />
                <span style={{ color: "var(--text-primary)" }}>
                  I confirm the music used in this video does not violate any
                  third-party rights.
                  <span
                    className="block text-[10px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Required by TikTok before publishing.
                  </span>
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--border-default)" }}
        >
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-xs font-medium"
            style={{
              background: "var(--bg-secondary)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-default)",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || totalTargets === 0 || !tiktokGateOk}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
            style={{
              background:
                totalTargets === 0 || !tiktokGateOk
                  ? "var(--bg-secondary)"
                  : "var(--accent-primary)",
              color: "white",
              opacity: totalTargets === 0 || !tiktokGateOk ? 0.5 : 1,
              cursor:
                totalTargets === 0 || !tiktokGateOk
                  ? "not-allowed"
                  : "pointer",
            }}
            title={
              !tiktokGateOk
                ? "Confirm TikTok music rights before publishing"
                : undefined
            }
          >
            <Send size={12} />
            {!tiktokGateOk
              ? "Confirm music rights first"
              : isDuplicate
              ? "Publish anyway"
              : `Publish to ${totalTargets}`}
          </button>
        </div>
      </div>
    </div>
  );
}
