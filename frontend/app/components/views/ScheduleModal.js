"use client";

import { useState, useRef } from "react";
import {
  X,
  Upload,
  Film,
  ImagePlus,
  Sparkles,
  Clock,
  CalendarDays,
} from "lucide-react";
import { PLATFORMS } from "../../lib/platforms";
import { isoDateKey, startOfToday, parseDateKey } from "../../lib/dateUtils";

/* Media source options (skeleton — backend wired later). Maps to plan tasks
   ME-T02 (upload+compress), ME-T03 (AI image: DALL-E / Stable Diffusion),
   VD-T01..T04 (AI video: ComfyUI / LTX). */
const MEDIA_SOURCES = [
  { id: "upload-image", kind: "image", source: "upload", label: "Upload Image", icon: Upload },
  { id: "upload-video", kind: "video", source: "upload", label: "Upload Video", icon: Film },
  { id: "ai-image", kind: "image", source: "ai", label: "Generate Image", icon: ImagePlus },
  { id: "ai-video", kind: "video", source: "ai", label: "Generate Video", icon: Sparkles },
];

let mediaUid = 0;

/**
 * Shared scheduling dialog used by both the calendar (quick-create on a day)
 * and the editor ("Schedule…"). `onSchedule` receives a post object that
 * already includes `scheduledDate` so callers just forward it to the thunk.
 */
export default function ScheduleModal({
  initialDate = null,
  initialContent = "",
  initialPlatforms,
  onClose,
  onSchedule,
}) {
  const [content, setContent] = useState(initialContent);
  const [platforms, setPlatforms] = useState(
    initialPlatforms ?? { facebook: true, instagram: true }
  );
  const [date, setDate] = useState(initialDate ?? isoDateKey(startOfToday()));
  const [time, setTime] = useState("09:00");
  const [media, setMedia] = useState([]);
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  const toggle = (id) => setPlatforms((p) => ({ ...p, [id]: !p[id] }));
  const addMedia = (m) =>
    setMedia((list) => [...list, { id: `m${++mediaUid}`, ...m }]);
  const removeMedia = (id) =>
    setMedia((list) => list.filter((m) => m.id !== id));

  const onPickFile = (kind) => (e) => {
    const file = e.target.files?.[0];
    if (file) addMedia({ kind, source: "upload", name: file.name });
    e.target.value = "";
  };

  const onChooseSource = (s) => {
    if (s.source === "upload") {
      (s.kind === "image" ? imageInputRef : videoInputRef).current?.click();
    } else {
      addMedia({ kind: s.kind, source: "ai", name: `AI ${s.kind} — generation pending` });
    }
  };

  const dayLabel = parseDateKey(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in"
      style={{ background: "rgba(15, 23, 42, 0.45)" }}
      onClick={onClose}
    >
      <div
        className="glass-card w-full max-w-md p-5"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            Schedule a post
          </h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: 6 }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          {dayLabel}
        </p>

        <textarea
          autoFocus
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What do you want to post?"
          rows={3}
          className="input-field"
          style={{ resize: "none", marginBottom: 14 }}
        />

        {/* Media source chooser */}
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
          Media
        </p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {MEDIA_SOURCES.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => onChooseSource(s)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-default)",
                  color: "var(--text-secondary)",
                }}
                title={s.source === "ai" ? "AI generation — backend wired later" : "Pick a file from your device"}
              >
                <Icon size={14} style={{ color: "var(--accent-primary)" }} />
                {s.label}
                {s.source === "ai" && (
                  <Sparkles size={11} style={{ color: "var(--status-pending)", marginLeft: "auto" }} />
                )}
              </button>
            );
          })}
        </div>
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onPickFile("image")} />
        <input ref={videoInputRef} type="file" accept="video/*" className="hidden" onChange={onPickFile("video")} />

        {media.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-4">
            {media.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs"
                style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}
              >
                {m.kind === "video" ? <Film size={13} /> : <ImagePlus size={13} />}
                <span className="flex-1 truncate">{m.name}</span>
                <span
                  className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded"
                  style={{
                    background: m.source === "ai" ? "rgba(245,158,11,0.15)" : "rgba(99,102,241,0.12)",
                    color: m.source === "ai" ? "var(--status-pending)" : "var(--accent-primary)",
                  }}
                >
                  {m.source}
                </span>
                <button onClick={() => removeMedia(m.id)} style={{ color: "var(--text-muted)" }} aria-label="Remove media">
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Platforms */}
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
          Platforms
        </p>
        <div className="flex flex-wrap gap-2 mb-4">
          {PLATFORMS.map((p) => {
            const Icon = p.icon;
            const on = !!platforms[p.id];
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-all inline-flex items-center gap-1.5"
                style={{
                  background: on ? "rgba(99, 102, 241, 0.12)" : "transparent",
                  border: `1px solid ${on ? "var(--border-active)" : "var(--border-default)"}`,
                  color: on ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                <Icon size={13} style={{ color: p.color }} />
                {p.label}
              </button>
            );
          })}
        </div>

        {/* Date + time */}
        <div className="flex flex-wrap items-center gap-4 mb-5">
          <div className="flex items-center gap-2">
            <CalendarDays size={14} style={{ color: "var(--text-muted)" }} />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input-field"
              style={{ width: 150 }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Clock size={14} style={{ color: "var(--text-muted)" }} />
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="input-field"
              style={{ width: 120 }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={() =>
              onSchedule({
                content: content.trim(),
                platforms,
                status: "draft",
                scheduledDate: date,
                time,
                media,
              })
            }
          >
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}
