"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Film,
  Plus,
  RefreshCcw,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Play,
  ExternalLink,
  ImagePlus,
  Type,
  Image as ImageIcon,
  Sparkles,
  MessageCircle,
  X,
} from "lucide-react";
import {
  createVideoJob,
  deleteVideoJob,
  listVideoJobs,
  listVideoModels,
} from "../../lib/videoJobsService";
import { uploadToBackend } from "../../lib/uploadService";
import { btnPrimary, card, fadeIn } from "../../lib/uiClasses";

/**
 * Management interface for AI video generation jobs.
 *
 * Lets the user pick a backend video model (fal.ai, OpenRouter, etc.),
 * choose a mode (text-to-video / image-to-video / UGC) and supply a
 * reference image when the model + mode call for one. Polls every 4s
 * so in-flight jobs show progress live. CreationEditor can stash a
 * prefill in sessionStorage to hand off prompt + reference image.
 */

const RATIOS = ["1:1", "4:5", "9:16", "16:9"];

// Mode catalogue — drives which controls are visible.
const MODES = [
  { id: "text", icon: Type, labelKey: "modeText" },
  { id: "image", icon: ImageIcon, labelKey: "modeImage" },
  { id: "ugc", icon: Sparkles, labelKey: "modeUgc", descKey: "modeUgcDesc" },
  { id: "talk", icon: MessageCircle, labelKey: "modeTalk", descKey: "modeTalkDesc" },
];

// Modes that animate a reference image (it's required for these).
const IMAGE_MODES = new Set(["image", "ugc", "talk"]);

// Session-storage key the Creation editor stashes the prefill into.
// Popped once on mount so a soft refresh doesn't re-apply stale state.
const PREFILL_KEY = "datalia.videoJobs.prefill";

const STATUS_META = {
  queued: { key: "statusQueued", icon: Clock, color: "var(--text-muted)" },
  running: { key: "statusRunning", icon: Loader2, color: "var(--status-pending)", spin: true },
  succeeded: { key: "statusReady", icon: CheckCircle2, color: "var(--status-approved)" },
  failed: { key: "statusFailed", icon: XCircle, color: "var(--status-error)" },
  cancelled: { key: "statusCancelled", icon: XCircle, color: "var(--text-muted)" },
};

export default function VideoJobsView() {
  const t = useTranslations("videos");
  const tCommon = useTranslations("common");
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("9:16");
  const [duration, setDuration] = useState(6);
  const [submitting, setSubmitting] = useState(false);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [mode, setMode] = useState("text");
  const [referenceImage, setReferenceImage] = useState(null); // { filename, url }
  const [uploadingImage, setUploadingImage] = useState(false);
  const [prefilledNotice, setPrefilledNotice] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    listVideoModels().then((data) => {
      const m = data?.models || [];
      setModels(m);
      setSelectedModel(data?.default || m[0]?.id || null);
    });
  }, []);

  // Pop the prefill stashed by the Creation editor's "AI video" button.
  useEffect(() => {
    queueMicrotask(() => {
      if (typeof window === "undefined") return;
      try {
        const raw = sessionStorage.getItem(PREFILL_KEY);
        if (!raw) return;
        const pre = JSON.parse(raw);
        sessionStorage.removeItem(PREFILL_KEY);
        if (pre.prompt) setPrompt(pre.prompt);
        if (pre.referenceImage) {
          setReferenceImage(pre.referenceImage);
          setMode(pre.mode || "image");
        }
        if (pre.ratio) setRatio(pre.ratio);
        setPrefilledNotice(true);
      } catch {
        /* ignore malformed prefill */
      }
    });
  }, []);

  const selectedModelObj = models.find((m) => m.id === selectedModel);
  const features = selectedModelObj?.features || {
    image_to_video: false,
    audio: false,
    max_duration_seconds: 15,
    supports_ugc: false,
    supports_talk: false,
    supported_aspect_ratios: RATIOS,
  };

  // Auto-flip mode when the model doesn't support what's selected.
  useEffect(() => {
    queueMicrotask(() => {
      if (!features.image_to_video && IMAGE_MODES.has(mode)) {
        setMode("text");
        setReferenceImage(null);
      }
      if ((mode === "ugc" && !features.supports_ugc) || (mode === "talk" && !features.supports_talk)) {
        setMode(features.image_to_video ? "image" : "text");
      }
    });
  }, [features.image_to_video, features.supports_ugc, features.supports_talk, mode]);

  // Clamp duration to model max.
  useEffect(() => {
    queueMicrotask(() => {
      if (features.max_duration_seconds && duration > features.max_duration_seconds) {
        setDuration(features.max_duration_seconds);
      }
    });
  }, [features.max_duration_seconds, duration]);

  useEffect(() => {
    queueMicrotask(() => {
      const supported = features.supported_aspect_ratios?.length
        ? features.supported_aspect_ratios
        : RATIOS;
      if (supported.includes(ratio)) return;
      if (ratio === "4:5" && supported.includes("9:16")) {
        setRatio("9:16");
        return;
      }
      setRatio(supported[0] || "9:16");
    });
  }, [features.supported_aspect_ratios, ratio]);

  const reload = useCallback(async () => {
    try {
      const data = await listVideoJobs();
      setJobs(data || []);
      setError(null);
    } catch (err) {
      setError(err.message || "Failed to load video jobs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      reload();
    });
    const id = setInterval(reload, 4000);
    return () => clearInterval(id);
  }, [reload]);

  async function handleImagePick(file) {
    if (!file) return;
    setUploadingImage(true);
    try {
      const res = await uploadToBackend(file);
      if (res.status !== "uploaded") {
        throw new Error(res.error || "Upload failed");
      }
      setReferenceImage({ filename: res.filename, url: res.remoteUrl });
      if (mode === "text") setMode("image");
    } catch (err) {
      setError(err.message || "Upload failed");
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!prompt.trim() || submitting) return;
    if (IMAGE_MODES.has(mode) && !referenceImage) {
      setError(t("referenceImageHint"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // UGC mode lightly prefixes the prompt so the model knows to
      // generate a creator-style shot of the supplied product.
      const finalPrompt =
        mode === "ugc"
          ? `UGC-style ad video: a person holding and showing this product to the camera, soft natural light, vertical handheld feel. ${prompt.trim()}`
          : prompt.trim();
      await createVideoJob({
        prompt: finalPrompt,
        ratio,
        durationSeconds: duration,
        imageFilename: referenceImage?.filename || null,
        provider: selectedModelObj?.provider || null,
        modelId: selectedModel,
        falModel: selectedModelObj?.provider === "fal" ? selectedModel : null,
        mode,
      });
      setPrompt("");
      setReferenceImage(null);
      setPrefilledNotice(false);
      reload();
    } catch (err) {
      setError(err.message || "Failed to queue job.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(jobId) {
    try {
      await deleteVideoJob(jobId);
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className={`h-full overflow-y-auto p-4 md:p-6 ${fadeIn}`}>
      <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1 inline-flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Film size={22} /> {t("title")}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("subtitle")}
          </p>
        </div>
        <button
          onClick={reload}
          className="p-2 rounded-lg transition-all"
          style={{
            background: "var(--bg-secondary)",
            color: "var(--text-muted)",
            border: "1px solid var(--border-default)",
          }}
          title={tCommon("refresh")}
        >
          <RefreshCcw size={14} />
        </button>
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded-lg text-sm"
          style={{ background: "var(--status-error-bg)", color: "var(--status-error)" }}
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 lg:[grid-template-columns:minmax(320px,1fr)_2fr]">
        <form onSubmit={handleCreate} className={card} style={{ padding: 18 }}>
          <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Plus size={14} /> {t("newVideo")}
          </h2>

          {prefilledNotice && (
            <div
              className="mb-3 p-2 rounded-md text-[11px] inline-flex items-center gap-2"
              style={{ background: "var(--bg-tertiary)", color: "var(--text-secondary)" }}
            >
              <Sparkles size={11} /> {t("prefilledFromEditor")}
            </div>
          )}

          <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
            {t("modelLabel")}
          </label>
          <select
            value={selectedModel || ""}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full p-2 rounded-lg text-sm mb-3"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {t("modelCostPerSec", { cost: m.cost_per_second_usd.toFixed(2) })}
              </option>
            ))}
          </select>

          <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
            {t("modeLabel")}
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-3">
            {MODES.map((m) => {
              const ModeIcon = m.icon;
              const disabled =
                (m.id === "image" && !features.image_to_video) ||
                (m.id === "ugc" && !features.supports_ugc) ||
                (m.id === "talk" && !features.supports_talk);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => !disabled && setMode(m.id)}
                  disabled={disabled}
                  className="py-2 px-2 text-[11px] font-medium rounded-lg transition-all inline-flex flex-col items-center gap-1"
                  style={{
                    background: mode === m.id ? "var(--accent-primary)" : "var(--bg-secondary)",
                    color: mode === m.id ? "white" : disabled ? "var(--text-tertiary)" : "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
                    opacity: disabled ? 0.45 : 1,
                    cursor: disabled ? "not-allowed" : "pointer",
                  }}
                  title={m.descKey ? t(m.descKey) : undefined}
                >
                  <ModeIcon size={14} />
                  {t(m.labelKey)}
                </button>
              );
            })}
          </div>

          {IMAGE_MODES.has(mode) && (
            <div className="mb-3">
              <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
                {t("referenceImage")}
              </label>
              {referenceImage ? (
                <div
                  className="relative rounded-lg overflow-hidden"
                  style={{ aspectRatio: "16/9", background: "var(--bg-tertiary)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={referenceImage.url}
                    alt="reference"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                  <button
                    type="button"
                    onClick={() => setReferenceImage(null)}
                    className="absolute top-1.5 right-1.5 p-1 rounded-full"
                    style={{ background: "rgba(0,0,0,0.6)", color: "#fff" }}
                    title={t("removeImage")}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingImage}
                  className="w-full py-3 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5"
                  style={{
                    background: "var(--bg-secondary)",
                    color: "var(--text-secondary)",
                    border: "1px dashed var(--border-default)",
                  }}
                >
                  {uploadingImage ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
                  {t("uploadImage")}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => handleImagePick(e.target.files?.[0])}
              />
              <p className="text-[10px] mt-1.5" style={{ color: "var(--text-tertiary)" }}>
                {t("referenceImageHint")}
              </p>
            </div>
          )}

          <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
            {t("prompt")}
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={
              mode === "ugc" ? t("ugcPromptHint") : mode === "talk" ? t("talkPromptHint") : t("promptPlaceholder")
            }
            rows={5}
            className="w-full p-2 rounded-lg text-sm mb-3"
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
              resize: "vertical",
            }}
          />

          <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
            {t("aspectRatio")}
          </label>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {RATIOS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() =>
                  (features.supported_aspect_ratios?.length
                    ? features.supported_aspect_ratios
                    : RATIOS
                  ).includes(r) && setRatio(r)
                }
                disabled={
                  !(features.supported_aspect_ratios?.length
                    ? features.supported_aspect_ratios
                    : RATIOS
                  ).includes(r)
                }
                className="py-2 text-xs font-medium rounded-lg transition-all"
                style={{
                  background: ratio === r ? "var(--accent-primary)" : "var(--bg-secondary)",
                  color: ratio === r ? "white" : "var(--text-secondary)",
                  border: "1px solid var(--border-default)",
                  opacity: (
                    features.supported_aspect_ratios?.length
                      ? features.supported_aspect_ratios
                      : RATIOS
                  ).includes(r)
                    ? 1
                    : 0.35,
                  cursor: (
                    features.supported_aspect_ratios?.length
                      ? features.supported_aspect_ratios
                      : RATIOS
                  ).includes(r)
                    ? "pointer"
                    : "not-allowed",
                }}
              >
                {r}
              </button>
            ))}
          </div>

          <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
            {t("duration", { n: duration })}
          </label>
          <input
            type="range"
            min={3}
            max={features.max_duration_seconds || 15}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full mb-4"
          />

          <button
            type="submit"
            disabled={submitting || !prompt.trim() || (IMAGE_MODES.has(mode) && !referenceImage)}
            className={`${btnPrimary} w-full inline-flex items-center justify-center gap-2`}
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
            {submitting ? t("queueing") : t("generate")}
          </button>
          <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
            {t("estCost", {
              eur: (
                duration *
                (selectedModelObj?.cost_per_second_usd ?? 0.04) *
                0.92
              ).toFixed(2),
            })}
          </p>
        </form>

        <div className={card} style={{ padding: 18 }}>
          <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Film size={14} /> {t("jobsCount", { n: jobs.length })}
          </h2>
          {loading && jobs.length === 0 ? (
            <p className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {tCommon("loading")}
            </p>
          ) : jobs.length === 0 ? (
            <p className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              {t("noJobs")}
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} onDelete={() => handleDelete(job.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function JobRow({ job, onDelete }) {
  const t = useTranslations("videos");
  const meta = STATUS_META[job.status] || STATUS_META.queued;
  const Icon = meta.icon;
  const statusLabel = t(meta.key);

  const handleDownload = async (e) => {
    e.preventDefault();
    if (!job.output_url) return;
    try {
      const res = await fetch(job.output_url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = job.output_filename || "video.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed, opening in new tab instead:", err);
      window.open(job.output_url, "_blank");
    }
  };

  return (
    <div
      className="p-3 rounded-lg"
      style={{
        background: "var(--bg-secondary)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div className="flex items-start gap-3">
        {job.output_url && job.status === "succeeded" ? (
          <video
            src={job.output_url}
            className="rounded-lg shrink-0"
            style={{ width: 96, height: 96, objectFit: "cover", background: "#000" }}
            muted
            loop
            playsInline
            onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
            onMouseLeave={(e) => e.currentTarget.pause()}
          />
        ) : (
          <div
            className="rounded-lg shrink-0 flex items-center justify-center"
            style={{
              width: 96,
              height: 96,
              background: "var(--bg-tertiary)",
              color: meta.color,
            }}
          >
            <Icon size={28} className={meta.spin ? "animate-spin" : ""} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p
              className="text-sm font-medium leading-snug"
              style={{ color: "var(--text-primary)" }}
              title={job.prompt}
            >
              {job.prompt.length > 100 ? `${job.prompt.slice(0, 100)}…` : job.prompt}
            </p>
            <button
              onClick={onDelete}
              className="p-1 rounded transition-all"
              style={{ color: "var(--text-muted)" }}
              title={t("deleteJob")}
            >
              <Trash2 size={13} />
            </button>
          </div>

          <div
            className="flex items-center gap-2 mt-1 text-[11px] flex-wrap"
            style={{ color: "var(--text-muted)" }}
          >
            <span
              className="px-1.5 py-0.5 rounded inline-flex items-center gap-1"
              style={{ background: "var(--bg-tertiary)", color: meta.color }}
            >
              <Icon size={10} className={meta.spin ? "animate-spin" : ""} />
              {statusLabel}
            </span>
            <span>{job.provider}</span>
            <span>·</span>
            <span>{job.ratio}</span>
            <span>·</span>
            <span>{job.duration_seconds}s</span>
            {job.cost_usd != null && (
              <>
                <span>·</span>
                <span>${job.cost_usd.toFixed(3)}</span>
              </>
            )}
          </div>

          {job.status === "running" && (
            <div
              className="mt-2 h-1.5 rounded-full overflow-hidden"
              style={{ background: "var(--bg-tertiary)" }}
            >
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.round((job.progress || 0) * 100)}%`,
                  background: "var(--accent-gradient)",
                }}
              />
            </div>
          )}

          {job.error && (
            <p className="text-[11px] mt-1" style={{ color: "var(--status-error)" }}>
              {job.error}
            </p>
          )}

          {job.output_url && job.status === "succeeded" && (
            <div className="flex items-center gap-3 mt-2">
              <a
                href={job.output_url}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] inline-flex items-center gap-1 hover:underline"
                style={{ color: "var(--accent-primary)" }}
              >
                <Play size={11} /> {t("openOutput")} <ExternalLink size={10} />
              </a>
              <button
                onClick={handleDownload}
                className="text-[11px] hover:underline"
                style={{
                  color: "var(--text-muted)",
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {t("download")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
