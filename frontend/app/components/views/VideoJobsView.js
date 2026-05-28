"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
import {
  createVideoJob,
  deleteVideoJob,
  listVideoJobs,
} from "../../lib/videoJobsService";

/**
 * Management interface for {t("title")} jobs.
 *
 * Each job is a queued call against the configured video provider —
 * LTX-Video via Replicate when REPLICATE_API_TOKEN is set, ffmpeg
 * Ken Burns as fallback. The view polls /video-jobs every few seconds
 * so an in-progress job shows its progress bar updating live.
 *
 * Create form on the left, job list on the right. Clicking a finished
 * job's preview opens a modal-less full-bleed player (keeps DOM simple).
 */
const RATIOS = ["1:1", "4:5", "9:16", "16:9"];

// Status keys map onto videos.statusXxx in the message bundles, resolved
// inside JobRow via useTranslations so a locale flip updates pills live.
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
    reload();
    // Poll every 4s so in-flight jobs update progress.
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [reload]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!prompt.trim() || submitting) return;
    setSubmitting(true);
    try {
      await createVideoJob({
        prompt: prompt.trim(),
        ratio,
        durationSeconds: duration,
      });
      setPrompt("");
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
    <div className="h-full overflow-y-auto animate-fade-in" style={{ padding: 24 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
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

        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "minmax(320px, 1fr) 2fr" }}
        >
          {/* Create form */}
          <form onSubmit={handleCreate} className="card" style={{ padding: 18 }}>
            <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Plus size={14} /> {t("newVideo")}
            </h2>

            <label className="text-[11px] uppercase tracking-wider block mb-1" style={{ color: "var(--text-muted)" }}>
              {t("prompt")}
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("promptPlaceholder")}
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
                  onClick={() => setRatio(r)}
                  className="py-2 text-xs font-medium rounded-lg transition-all"
                  style={{
                    background: ratio === r ? "var(--accent-primary)" : "var(--bg-secondary)",
                    color: ratio === r ? "white" : "var(--text-secondary)",
                    border: "1px solid var(--border-default)",
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
              max={15}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full mb-4"
            />

            <button
              type="submit"
              disabled={submitting || !prompt.trim()}
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
              {submitting ? t("queueing") : t("generate")}
            </button>
            <p className="text-[11px] mt-3" style={{ color: "var(--text-tertiary)" }}>
              {t("costNote", { eur: (duration * 0.04 * 0.92).toFixed(2) })}
            </p>
          </form>

          {/* Jobs list */}
          <div className="card" style={{ padding: 18 }}>
            <h2 className="text-sm font-semibold mb-3 inline-flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Film size={14} /> {t("jobsCount", {n: jobs.length})}
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
    </div>
  );
}

function JobRow({ job, onDelete }) {
  const t = useTranslations("videos");
  const meta = STATUS_META[job.status] || STATUS_META.queued;
  const Icon = meta.icon;
  const statusLabel = t(meta.key);
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
            className="flex items-center gap-2 mt-1 text-[11px]"
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
                className="text-[11px] inline-flex items-center gap-1"
                style={{ color: "var(--accent-primary)" }}
              >
                <Play size={11} /> {t("openOutput")} <ExternalLink size={10} />
              </a>
              <a
                href={job.output_url}
                download={job.output_filename}
                className="text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                {t("download")}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
