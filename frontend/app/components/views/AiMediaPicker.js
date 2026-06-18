"use client";

import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { X, Sparkles, Loader2 } from "lucide-react";
import { listMedia } from "../../lib/searchService";
import { config } from "../../lib/config";
import { addMedia } from "../../store/editorSlice";
import { setActiveView } from "../../store/uiSlice";

// Generated media lives under the workspace's content dir at
// content/ws/{id}/generated/ — so search hits whose id contains "generated/"
// are this workspace's AI media (isolated per tenant by the backend).
const contentUrl = (id) =>
  config.apiBaseUrl ? `${config.apiBaseUrl}/content/${id}` : `/content/${id}`;

/**
 * Picker of AI-generated media the user made in the Image IA / Vidéo IA tabs
 * (CEO #5), opened from the Create composer's media step. Sourced from the
 * backend media search filtered to this workspace's generated/ media — so it's
 * device-independent and workspace-scoped, like uploads. Picking adds the item
 * to the post; the footer link jumps to the matching studio to generate more.
 */
export default function AiMediaPicker({ kind, onClose }) {
  const t = useTranslations("creation");
  const tCommon = useTranslations("common");
  const dispatch = useDispatch();
  const targetView = kind === "video" ? "videos" : "image";
  const [items, setItems] = useState(null); // null = loading

  useEffect(() => {
    let alive = true;
    (async () => {
      const hits = await listMedia("");
      const gen = (hits || []).filter(
        (h) => h.kind === kind && (h.id || "").includes("generated/")
      );
      if (alive) setItems(gen);
    })();
    return () => {
      alive = false;
    };
  }, [kind]);

  const pick = (h) => {
    const url = contentUrl(h.id);
    dispatch(
      addMedia([
        {
          id: `lib-${h.id}`,
          name: h.title || h.id.split("/").pop(),
          kind,
          previewUrl: url,
          remoteUrl: url,
          status: "uploaded",
          filename: h.id,
        },
      ])
    );
    onClose();
  };

  const goGenerate = () => {
    dispatch(setActiveView(targetView));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.5)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-2xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)", maxHeight: "85vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border-default)" }}>
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
            {kind === "video" ? t("aiPickVideoTitle") : t("aiPickImageTitle")}
          </h3>
          <button onClick={onClose} aria-label={tCommon("close")} style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {items === null ? (
            <div className="flex justify-center py-10">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" style={{ color: "var(--text-muted)" }}>
              <Sparkles size={28} className="opacity-40" />
              <p className="text-sm">{t("aiPickerEmpty")}</p>
              <button
                type="button"
                onClick={goGenerate}
                className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                style={{ background: "var(--accent-primary)", border: "none", cursor: "pointer" }}
              >
                {t("aiPickerGenerate")}
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((h) => {
                const url = contentUrl(h.id);
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => pick(h)}
                      className="relative w-full overflow-hidden rounded-lg"
                      style={{ aspectRatio: "1 / 1", border: "1px solid var(--border-default)", background: "var(--bg-elevated)", cursor: "pointer", padding: 0 }}
                      title={h.title}
                    >
                      {kind === "video" ? (
                        <video src={url} className="h-full w-full object-cover" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={h.title || ""} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--border-default)" }}>
          {/* The empty state already shows a centered "Generate new" CTA, so the
              footer link is only rendered when there ARE items (otherwise it's a
              duplicate of the centered button). Keeps exactly one per state. */}
          {items && items.length > 0 ? (
            <button
              type="button"
              onClick={goGenerate}
              className="inline-flex items-center gap-1.5 text-xs font-semibold"
              style={{ color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer" }}
            >
              <Sparkles size={13} /> {t("aiPickerGenerate")}
            </button>
          ) : (
            <span />
          )}
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1px solid var(--border-default)", cursor: "pointer" }}
          >
            {tCommon("cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
