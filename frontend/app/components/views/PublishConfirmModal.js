"use client";

import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { X, Send, AlertTriangle, Music, UserCheck } from "lucide-react";
import { fetchConnections } from "../../lib/oauthService";
import { PLATFORMS } from "../../lib/platforms";
import { setTiktokOptions } from "../../store/editorSlice";
import TikTokOptionsPanel from "./TikTokOptionsPanel";

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
  const [isConfirming, setIsConfirming] = useState(false);

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
        className="w-full max-w-md rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          boxShadow: "0 24px 48px rgba(15,23,42,0.4)",
          // Cap modal height so the body scrolls instead of pushing
          // header/footer off-screen on small viewports.
          maxHeight: "calc(100vh - 2rem)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — fixed at top */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
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

        {/* Body — scrolls when content exceeds available space */}
        <div className="px-5 py-4 space-y-3 overflow-y-auto flex-1 min-h-0">
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
          {tiktokEnabled && <TikTokOptionsPanel />}
        </div>

        {/* Footer — pinned to bottom */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
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
            onClick={() => {
              if (isConfirming) return;
              setIsConfirming(true);
              onConfirm();
            }}
            disabled={loading || isConfirming || totalTargets === 0 || !tiktokGateOk}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
            style={{
              background:
                totalTargets === 0 || !tiktokGateOk
                  ? "var(--bg-secondary)"
                  : "var(--accent-primary)",
              color: "white",
              opacity: totalTargets === 0 || !tiktokGateOk || isConfirming ? 0.5 : 1,
              cursor:
                totalTargets === 0 || !tiktokGateOk || isConfirming
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
              : isConfirming
              ? "Publishing..."
              : isDuplicate
              ? "Publish anyway"
              : `Publish to ${totalTargets}`}
          </button>
        </div>
      </div>
    </div>
  );
}
