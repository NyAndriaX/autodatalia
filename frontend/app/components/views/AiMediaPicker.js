"use client";

import { useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { X, Sparkles } from "lucide-react";
import { listAiMedia } from "../../lib/aiMediaStore";
import { addMedia } from "../../store/editorSlice";
import { setActiveView } from "../../store/uiSlice";

// Map a generated-media URL back to its content-dir-relative filename.
function urlToFilename(url) {
  let path = url;
  try {
    path = new URL(url, "http://x").pathname;
  } catch {
    /* relative URL — use as-is */
  }
  const marker = "/content/";
  const i = path.indexOf(marker);
  return i === -1 ? path.split("/").pop() : path.slice(i + marker.length);
}

/**
 * Picker of AI-generated media the user made in the Image IA / Vidéo IA tabs
 * (CEO #5), opened from the Create composer's media step. Sourced from the
 * per-workspace client-side recall (aiMediaStore). Picking adds the item to the
 * post as already-"uploaded" media; the footer link jumps to the matching
 * studio to generate more.
 */
export default function AiMediaPicker({ kind, onClose }) {
  const t = useTranslations("creation");
  const tCommon = useTranslations("common");
  const dispatch = useDispatch();
  const items = listAiMedia(kind);
  const targetView = kind === "video" ? "videos" : "image";

  const pick = (m) => {
    dispatch(
      addMedia([
        {
          id: `lib-${m.url}`,
          name: m.name || (kind === "video" ? "AI video" : "AI image"),
          kind,
          previewUrl: m.url,
          remoteUrl: m.url,
          status: "uploaded",
          filename: urlToFilename(m.url),
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
          {items.length === 0 ? (
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
              {items.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => pick(m)}
                    className="relative w-full overflow-hidden rounded-lg"
                    style={{ aspectRatio: "1 / 1", border: "1px solid var(--border-default)", background: "var(--bg-elevated)", cursor: "pointer", padding: 0 }}
                    title={m.name}
                  >
                    {kind === "video" ? (
                      <video src={m.url} className="h-full w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt={m.name || ""} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--border-default)" }}>
          <button
            type="button"
            onClick={goGenerate}
            className="inline-flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer" }}
          >
            <Sparkles size={13} /> {t("aiPickerGenerate")}
          </button>
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
