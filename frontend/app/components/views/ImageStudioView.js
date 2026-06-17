"use client";

import { useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2, ImagePlus, Wand2 } from "lucide-react";
import { btnPrimary, btnSecondary, inputField } from "../../lib/uiClasses";
import { generateImageAsset } from "../../lib/mediaGenerationService";
import { addMedia } from "../../store/editorSlice";
import { addNotification, setActiveView } from "../../store/uiSlice";
import { recordAiMedia } from "../../lib/aiMediaStore";

const RATIOS = ["1:1", "4:5", "9:16", "16:9", "1.91:1"];

// Optional prompt modifiers. `prompt` is the English descriptor appended to the
// user's prompt (kept English so the model gets consistent direction regardless
// of UI language); `labelKey` is the translated chip label.
const OPTION_GROUPS = [
  {
    key: "style",
    labelKey: "styleLabel",
    options: [
      { id: "photo", labelKey: "stylePhoto", prompt: "photorealistic photo" },
      { id: "illustration", labelKey: "styleIllustration", prompt: "illustration" },
      { id: "render3d", labelKey: "style3d", prompt: "3D render" },
      { id: "minimal", labelKey: "styleMinimal", prompt: "minimalist, clean composition" },
    ],
  },
  {
    key: "palette",
    labelKey: "paletteLabel",
    options: [
      { id: "warm", labelKey: "paletteWarm", prompt: "warm color palette" },
      { id: "cool", labelKey: "paletteCool", prompt: "cool color palette" },
      { id: "vibrant", labelKey: "paletteVibrant", prompt: "vibrant, saturated colors" },
      { id: "pastel", labelKey: "palettePastel", prompt: "soft pastel colors" },
    ],
  },
  {
    key: "light",
    labelKey: "lightLabel",
    options: [
      { id: "soft", labelKey: "lightSoft", prompt: "soft lighting" },
      { id: "studio", labelKey: "lightStudio", prompt: "studio lighting" },
      { id: "natural", labelKey: "lightNatural", prompt: "natural light" },
      { id: "dramatic", labelKey: "lightDramatic", prompt: "dramatic, cinematic lighting" },
    ],
  },
];

/**
 * "Image IA" — standalone AI image generation under Creation. Generates via the
 * backend (/media/generate/image) which writes the file to the content dir, so
 * the result is automatically in the Library. Optional style/colour/lighting
 * modifiers (+ an accent colour) get appended to the prompt. "Use in a post"
 * drops the result into the editor.
 */
export default function ImageStudioView() {
  const t = useTranslations("imageStudio");
  const dispatch = useDispatch();
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("1:1");
  const [mods, setMods] = useState({}); // group.key -> option.id
  const [accent, setAccent] = useState(""); // hex, optional
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { data, mediaItem }

  const buildPrompt = () => {
    const parts = [];
    for (const g of OPTION_GROUPS) {
      const sel = g.options.find((o) => o.id === mods[g.key]);
      if (sel) parts.push(sel.prompt);
    }
    if (accent) parts.push(`dominant color ${accent}`);
    const base = prompt.trim();
    return parts.length ? `${base}. ${parts.join(", ")}.` : base;
  };

  const toggleMod = (key, id) =>
    setMods((m) => ({ ...m, [key]: m[key] === id ? undefined : id }));

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const r = await generateImageAsset({ prompt: buildPrompt(), ratio });
      setResult(r);
      // Remember it for the Create composer's "Image IA" picker.
      recordAiMedia({ kind: "image", url: r?.mediaItem?.remoteUrl, name: r?.mediaItem?.name });
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

  const groupLabelCls = "mb-1 text-[10px] font-semibold uppercase tracking-wider";

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

          {/* Optional modifiers (CEO #7) */}
          <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            {t("optionsTitle")}
          </p>
          <div className="space-y-3">
            {OPTION_GROUPS.map((g) => (
              <div key={g.key}>
                <p className={groupLabelCls} style={{ color: "var(--text-tertiary)" }}>{t(g.labelKey)}</p>
                <div className="flex flex-wrap gap-1.5">
                  {g.options.map((o) => {
                    const on = mods[g.key] === o.id;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => toggleMod(g.key, o.id)}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium"
                        style={{
                          background: on ? "var(--accent-primary)" : "var(--bg-tertiary)",
                          color: on ? "#fff" : "var(--text-secondary)",
                          border: "1px solid var(--border-default)",
                          cursor: "pointer",
                        }}
                      >
                        {t(o.labelKey)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div>
              <p className={groupLabelCls} style={{ color: "var(--text-tertiary)" }}>{t("accentLabel")}</p>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accent || "#1d3fbe"}
                  onChange={(e) => setAccent(e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded-lg"
                  style={{ border: "1px solid var(--border-default)", background: "none", padding: 2 }}
                  aria-label={t("accentLabel")}
                />
                {accent && (
                  <button
                    type="button"
                    onClick={() => setAccent("")}
                    className="text-[11px]"
                    style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}
                  >
                    {t("accentClear")}
                  </button>
                )}
              </div>
            </div>
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
