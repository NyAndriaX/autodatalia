"use client";

import { useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, ImagePlus, Wand2 } from "lucide-react";
import { btnPrimary, btnSecondary, inputField } from "../../lib/uiClasses";
import { generateImageAsset } from "../../lib/mediaGenerationService";
import { addMedia } from "../../store/editorSlice";
import { addNotification, setActiveView } from "../../store/uiSlice";

const RATIOS = ["1:1", "4:5", "9:16", "16:9", "1.91:1"];

/**
 * "Image IA" — standalone AI image generation under Creation. Generates via the
 * backend (/media/generate/image, same as the editor) which writes the file to
 * the content dir, so the result is automatically in the Library. "Use in a
 * post" drops it straight into the editor.
 */
export default function ImageStudioView() {
  const t = useTranslations("imageStudio");
  const dispatch = useDispatch();
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { data, mediaItem }

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const r = await generateImageAsset({ prompt: prompt.trim(), ratio });
      setResult(r);
      dispatch(addNotification({ message: t("savedToLibrary"), type: "success" }));
    } catch (err) {
      dispatch(
        addNotification({ message: t("failed", { error: err.message || "unknown" }), type: "error" })
      );
    } finally {
      setBusy(false);
    }
  };

  const useInPost = () => {
    if (!result?.mediaItem) return;
    dispatch(addMedia([result.mediaItem]));
    dispatch(setActiveView("creation"));
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6" style={{ background: "var(--bg-primary)" }}>
      <div className="mb-6">
        <h1 className="text-xl font-extrabold" style={{ color: "var(--text-primary)" }}>{t("title")}</h1>
        <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>{t("subtitle")}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Controls */}
        <div className="rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}>
          <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            {t("promptLabel")}
          </label>
          <textarea
            className={inputField}
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("promptPlaceholder")}
            style={{ resize: "none" }}
          />
          <label className="mb-1.5 mt-4 block text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            {t("ratioLabel")}
          </label>
          <div className="flex flex-wrap gap-2">
            {RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatio(r)}
                className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                style={{
                  background: ratio === r ? "var(--accent-primary)" : "var(--bg-tertiary)",
                  color: ratio === r ? "#fff" : "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                  cursor: "pointer",
                }}
              >
                {r}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={busy || !prompt.trim()}
            className={`${btnPrimary} mt-5 inline-flex items-center gap-2`}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {t("generate")}
          </button>
        </div>

        {/* Result */}
        <div className="flex flex-col rounded-2xl p-5" style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}>
          {result?.mediaItem ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.mediaItem.remoteUrl || result.mediaItem.previewUrl}
                alt=""
                className="w-full rounded-xl object-contain"
                style={{ maxHeight: 360, background: "var(--bg-elevated)" }}
                referrerPolicy="no-referrer"
              />
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                {t("savedHint", { provider: result.data?.provider || "AI" })}
              </p>
              <button type="button" onClick={useInPost} className={`${btnSecondary} mt-3 inline-flex items-center gap-2 text-sm`}>
                <ImagePlus size={14} /> {t("useInPost")}
              </button>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center" style={{ color: "var(--text-muted)", minHeight: 240 }}>
              <Wand2 size={36} className="mb-3 opacity-30" />
              <p className="text-sm">{t("emptyState")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
