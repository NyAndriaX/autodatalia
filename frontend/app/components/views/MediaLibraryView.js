"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  Sparkles,
  Palette,
  Image as ImageIcon,
  Film,
  Lock,
  Search,
} from "lucide-react";
import { listMedia } from "../../lib/searchService";
import {
  ACCEPTED_TYPES,
  MAX_SIZE_BYTES,
  uploadToBackend,
  validateFile,
} from "../../lib/uploadService";

const TABS = [
  { id: "uploads", label: "Uploads", icon: ImageIcon },
  { id: "ai", label: "AI-Generated", icon: Sparkles },
  { id: "brand", label: "Brand Kit", icon: Palette },
];

function Tile({ item }) {
  const Icon = item.kind === "video" ? Film : ImageIcon;
  const hasPreview = item.previewUrl && item.kind === "image";
  return (
    <div
      className="relative rounded-xl overflow-hidden flex items-center justify-center"
      style={{
        aspectRatio: "1 / 1",
        background: hasPreview
          ? `center / cover no-repeat url(${item.previewUrl})`
          : "linear-gradient(135deg, var(--bg-tertiary), var(--bg-elevated))",
        border: "1px solid var(--border-default)",
      }}
      title={item.name}
    >
      {!hasPreview && (
        <Icon size={28} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
      )}
      {item.status === "uploading" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ background: "rgba(15,23,42,0.55)", color: "#fff" }}
        >
          Uploading…
        </div>
      )}
      {item.status === "error" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs px-2 text-center"
          style={{ background: "rgba(220,38,38,0.65)", color: "#fff" }}
        >
          {item.error || "Upload failed"}
        </div>
      )}
      <span
        className="absolute bottom-0 inset-x-0 px-2 py-1 text-[10px] truncate"
        style={{ background: "rgba(15,23,42,0.45)", color: "#fff" }}
      >
        {item.name}
      </span>
    </div>
  );
}

export default function MediaLibraryView() {
  const [tab, setTab] = useState("uploads");
  // Locally-known uploads (this session) — backend-persisted hits come from /search.
  const [uploads, setUploads] = useState([]);
  const [remoteHits, setRemoteHits] = useState([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const fileInputRef = useRef(null);
  const seq = useRef(0);

  // Fetch remote media on mount and whenever the query changes (debounced).
  useEffect(() => {
    if (tab !== "uploads") return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      const hits = await listMedia(query.trim());
      if (!cancelled) {
        setRemoteHits(hits);
        setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, tab]);

  const handleFiles = useCallback(async (files) => {
    const items = [];
    for (const file of files) {
      const err = validateFile(file);
      const id = `u_${Date.now()}_${seq.current++}`;
      if (err) {
        items.push({
          id,
          kind: file.type.startsWith("video/") ? "video" : "image",
          name: file.name,
          status: "error",
          error: err,
        });
        continue;
      }
      items.push({
        id,
        kind: file.type.startsWith("video/") ? "video" : "image",
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
        _file: file,
      });
    }
    setUploads((prev) => [...items, ...prev]);

    // Push each upload to the backend in parallel.
    await Promise.all(
      items
        .filter((it) => it.status === "uploading")
        .map(async (it) => {
          const result = await uploadToBackend(it._file);
          setUploads((prev) =>
            prev.map((p) =>
              p.id === it.id
                ? {
                    ...p,
                    _file: null,
                    status: result.status === "uploaded" ? "uploaded" : "error",
                    error: result.status === "uploaded" ? null : "Backend offline",
                    remoteUrl: result.remoteUrl,
                  }
                : p
            )
          );
        })
    );
    // Re-pull the remote listing so backend-persisted assets show up below.
    const hits = await listMedia(query.trim());
    setRemoteHits(hits);
  }, [query]);

  const onFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) handleFiles(files);
  };

  const onDrop = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) handleFiles(files);
  };

  // Build the displayed grid: this-session uploads first, then de-duplicated
  // backend hits (avoid showing the same filename twice).
  const sessionNames = new Set(uploads.map((u) => u.name));
  const items =
    tab === "uploads"
      ? [
          ...uploads,
          ...remoteHits
            .filter((h) => !sessionNames.has(h.title))
            .map((h) => ({
              id: h.id,
              kind: h.subtitle?.toLowerCase().includes("video") ? "video" : "image",
              name: h.title,
              status: "uploaded",
              previewUrl: null,
            })),
        ]
      : [];

  const isBrand = tab === "brand";
  const isAI = tab === "ai";

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ padding: 20 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-2 flex-wrap">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: on ? "rgba(99,102,241,0.12)" : "var(--bg-tertiary)",
                  color: on ? "var(--accent-primary-hover)" : "var(--text-secondary)",
                  border: `1px solid ${on ? "rgba(99,102,241,0.3)" : "var(--border-default)"}`,
                }}
              >
                <Icon size={15} />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "uploads" && (
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5"
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-default)",
              }}
            >
              <Search size={14} style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search media"
                className="bg-transparent outline-none text-sm"
                style={{ color: "var(--text-primary)", width: 160 }}
              />
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              hidden
              onChange={onFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-primary inline-flex items-center gap-2"
            >
              <UploadCloud size={16} />
              Upload media
            </button>
          </div>
        )}
      </div>

      {tab === "uploads" && (
        <>
          {items.length > 0 ? (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}
            >
              {items.map((it) => (
                <Tile key={it.id} item={it} />
              ))}
            </div>
          ) : (
            <div
              className="rounded-xl flex flex-col items-center justify-center text-center gap-2 py-16"
              style={{
                background: "var(--bg-card)",
                border: "1px dashed var(--border-default)",
                color: "var(--text-muted)",
              }}
            >
              <UploadCloud size={30} className="opacity-40" />
              <p className="text-sm">
                {searching
                  ? "Searching…"
                  : "Drag files here or click Upload to add media."}
              </p>
              <p className="text-xs">Max {Math.round(MAX_SIZE_BYTES / 1024 / 1024)} MB per file</p>
            </div>
          )}
        </>
      )}

      {isAI && (
        <div
          className="rounded-xl flex flex-col items-center justify-center text-center gap-2 py-16"
          style={{ background: "var(--bg-card)", border: "1px dashed var(--border-default)", color: "var(--text-muted)" }}
        >
          <Sparkles size={30} className="opacity-40" />
          <p className="text-sm">AI-generated assets</p>
          <p className="text-xs">ComfyUI / LTX wiring (VD-T01 → VD-T04)</p>
        </div>
      )}

      {isBrand && (
        <div
          className="rounded-xl flex flex-col items-center justify-center text-center gap-2 py-16"
          style={{ background: "var(--bg-card)", border: "1px dashed var(--border-default)", color: "var(--text-muted)" }}
        >
          <Palette size={30} className="opacity-40" />
          <p className="text-sm">Brand Kit — logos, palette & fonts</p>
          <p className="text-xs">Configured in Settings (TP-T03)</p>
        </div>
      )}

      {tab === "uploads" && (
        <div className="mt-5 flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Lock size={12} />
          Uploads persist to the backend `/upload` endpoint. AI assets and Brand Kit are pending.
        </div>
      )}
    </div>
  );
}
