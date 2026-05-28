"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  UploadCloud,
  Sparkles,
  Palette,
  Image as ImageIcon,
  Film,
  Search,
  Trash2,
  Wand2,
  CalendarClock,
  X,
  Check,
  CheckCheck,
} from "lucide-react";
import { listMedia } from "../../lib/searchService";
import {
  ACCEPTED_TYPES,
  MAX_SIZE_BYTES,
  deleteFromBackend,
  uploadToBackend,
  validateFile,
} from "../../lib/uploadService";
import { addMedia } from "../../store/editorSlice";
import { addNotification, setActiveView } from "../../store/uiSlice";

const TABS = [
  { id: "uploads", label: "Uploads", icon: ImageIcon },
  { id: "ai", label: "AI-Generated", icon: Sparkles },
  { id: "brand", label: "Brand Kit", icon: Palette },
];

/* Tile design follows the canonical Google-Photos / Dropbox gallery
   pattern: a hover gradient overlay reveals a primary action (Use) and
   secondary actions (delete) appear in the corners. The "Used in N posts"
   badge top-left tells the team which assets are doing work so cleanup
   decisions don't accidentally delete an in-use image. */
function Tile({ item, onDelete, onUse, usageCount = 0, selected, onToggleSelect, selectionMode }) {
  const Icon = item.kind === "video" ? Film : ImageIcon;
  // Prefer the persisted server URL — the local blob: previewUrl can be
  // revoked or invalidated by a dev HMR reload or after sitting unused.
  const previewSrc = item.remoteUrl || item.previewUrl;
  const isImage = item.kind === "image";
  const isVideo = item.kind === "video";
  const hasImagePreview = previewSrc && isImage;
  const hasVideoPreview = previewSrc && isVideo;
  const canDelete = !!onDelete && item.status !== "uploading";
  const canUse = !!onUse && item.status === "uploaded" && !!item.remoteUrl;
  const canSelect = item.status === "uploaded" || !!item.remoteUrl;
  
  return (
    <div
      className={`group relative rounded-xl overflow-hidden flex items-center justify-center ${canSelect ? "cursor-pointer" : ""}`}
      style={{
        aspectRatio: "1 / 1",
        background: hasImagePreview
          ? `center / cover no-repeat url(${previewSrc})`
          : "linear-gradient(135deg, var(--bg-tertiary), var(--bg-elevated))",
        border: selected ? "2px solid var(--accent-primary)" : "1px solid var(--border-default)",
        boxShadow: selected ? "0 0 0 2px var(--accent-primary-hover)" : "none",
      }}
      title={item.name}
      onClick={() => {
        if (selectionMode && canSelect) {
          onToggleSelect(item);
        }
      }}
    >
      {hasVideoPreview && (
        <video
          src={previewSrc}
          muted
          playsInline
          preload="metadata"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {!hasImagePreview && !hasVideoPreview && (
        <Icon size={28} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
      )}

      {/* Selection toggle — custom styled pill (replaces the native
          checkbox whose default "unchecked" state rendered as a bare
          white square on dark thumbnails). Visible when selected, on
          hover, or whenever any sibling is already selected (so the
          user can extend the selection easily). */}
      {canSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(item);
          }}
          aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`}
          aria-pressed={!!selected}
          className={`absolute top-1.5 left-1.5 z-10 w-6 h-6 inline-flex items-center justify-center rounded-md transition-opacity ${
            selected || selectionMode
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
          style={{
            background: selected
              ? "var(--accent-primary)"
              : "rgba(15, 23, 42, 0.55)",
            border: selected
              ? "1.5px solid var(--accent-primary)"
              : "1.5px solid rgba(255, 255, 255, 0.7)",
            backdropFilter: selected ? "none" : "blur(2px)",
            boxShadow: "0 1px 4px rgba(0, 0, 0, 0.4)",
          }}
        >
          {selected && <Check size={14} color="#fff" strokeWidth={3} />}
        </button>
      )}

      {/* Top-left badges (stacked) — shifted down if checkbox is present. */}
      <div className={`absolute left-1.5 flex flex-col items-start gap-1 transition-all pointer-events-none ${canSelect ? "top-8" : "top-1.5"}`}>
        {isVideo && (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-full"
            style={{ background: "rgba(0,0,0,0.55)" }}
            aria-label="Video"
            title="Video"
          >
            <Film size={11} className="text-white" />
          </span>
        )}
        {usageCount > 0 && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
            style={{
              background: "rgba(99, 102, 241, 0.9)",
              color: "#fff",
              backdropFilter: "blur(4px)",
            }}
            title={`Referenced in ${usageCount} scheduled or published post${
              usageCount === 1 ? "" : "s"
            }`}
          >
            <CalendarClock size={10} aria-hidden="true" />
            {usageCount}
          </span>
        )}
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-7 h-7 rounded-full opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          style={{
            background: "rgba(15,23,42,0.7)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
          aria-label={`Delete ${item.name}`}
          title="Delete"
        >
          <Trash2 size={13} />
        </button>
      )}

      {/* Hover gradient + primary action — only when the item is actually
          usable (uploaded + has remoteUrl) AND we're not in selection mode.
          In selection mode the click target is the tile itself (for
          toggling), so the floating "Use in new post" button would steal
          clicks and confuse the multi-select flow — bulk posting lives in
          the top bar instead. */}
      {canUse && !selectionMode && (
        <div
          className="absolute inset-0 flex items-end justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          style={{
            background:
              "linear-gradient(to top, rgba(15,23,42,0.78) 0%, rgba(15,23,42,0.0) 55%)",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUse(item);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-2 rounded-full text-xs font-semibold transition-transform"
            style={{
              background: "var(--accent-primary)",
              color: "#fff",
              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.35)",
            }}
            title="Add this asset to a new post"
            onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.97)")}
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            <Wand2 size={12} aria-hidden="true" />
            Use in new post
          </button>
        </div>
      )}

      {item.status === "uploading" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ background: "rgba(15,23,42,0.55)", color: "#fff" }}
        >
          Uploading…
        </div>
      )}
      {item.status === "deleting" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ background: "rgba(15,23,42,0.55)", color: "#fff" }}
        >
          Deleting…
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
  const dispatch = useDispatch();
  const scheduledPosts = useSelector((s) => s.calendar.scheduledPosts);
  const [tab, setTab] = useState("uploads");
  // Locally-known uploads (this session) — backend-persisted hits come from /search.
  const [uploads, setUploads] = useState([]);
  const [remoteHits, setRemoteHits] = useState([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const fileInputRef = useRef(null);
  const seq = useRef(0);
  const useSeq = useRef(0);

  // Normalized item list — same shape the Tile expects. Built ONCE
  // here so the render path and the bulk handlers (use-in-post,
  // select-all, delete) all read the same thing. The earlier bug was
  // that bulk handlers iterated `remoteHits` directly (shape
  // `{id, title, kind, url}`) and filtered on `remoteUrl`/`previewUrl`
  // which only exist on the normalized shape — every bulk action
  // silently no-op'd for backend-listed assets.
  const normalizedItems = useMemo(() => {
    const sessionNames = new Set(uploads.map((u) => u.name));
    return [
      ...uploads,
      ...remoteHits
        .filter((h) => !sessionNames.has(h.title))
        .map((h) => ({
          id: h.id,
          kind:
            h.kind ||
            (h.subtitle?.toLowerCase().includes("video") ? "video" : "image"),
          name: h.title,
          status: "uploaded",
          remoteUrl: h.url || null,
          previewUrl: null,
        })),
    ];
  }, [uploads, remoteHits]);

  const handleToggleSelect = useCallback((item) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  // Select-all / clear-all on the currently visible tile set. Reads
  // `normalizedItems` (not the raw arrays) so backend-listed assets get
  // picked up too.
  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of normalizedItems) {
        if (it.status === "uploaded" || it.remoteUrl) next.add(it.id);
      }
      return next;
    });
  }, [normalizedItems]);

  // Map of media filename / remote URL → number of scheduled or published
  // posts that reference it. Built once per scheduledPosts change so the
  // tile lookup below is O(1). Empty when no posts use any asset, which
  // is the common case at boot.
  const usageByName = useMemo(() => {
    const counts = new Map();
    for (const post of scheduledPosts) {
      if (!Array.isArray(post.media)) continue;
      for (const m of post.media) {
        const keys = [m.filename, m.name, m.remoteUrl].filter(Boolean);
        for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
    return counts;
  }, [scheduledPosts]);

  const usageCountFor = useCallback(
    (item) => {
      const candidates = [item.name, item.id, item.remoteUrl].filter(Boolean);
      let max = 0;
      for (const c of candidates) {
        const v = usageByName.get(c) || 0;
        if (v > max) max = v;
      }
      return max;
    },
    [usageByName]
  );

  // "Use in new post": append the library item to the editor's currentPost
  // (no clobber of in-flight content), navigate to the Creation view, and
  // surface a notification so the user knows where to find it. The
  // backend filename rides along so the AI's vision routing kicks in on
  // the next Generate without a re-upload.
  const onUseInPost = useCallback(
    (item) => {
      const newId = `lib_${Date.now()}_${useSeq.current++}`;
      dispatch(
        addMedia([
          {
            id: newId,
            name: item.name,
            kind: item.kind || "image",
            previewUrl: item.remoteUrl || item.previewUrl || null,
            remoteUrl: item.remoteUrl || null,
            status: "uploaded",
            // Backend search returns the content-dir-relative path as `id`.
            // Strip any folder prefix because /upload writes flat into
            // content_dir and /generate expects just the filename.
            filename: (item.id || item.name || "").split("/").pop(),
          },
        ])
      );
      dispatch(setActiveView("creation"));
      dispatch(
        addNotification({
          message: `Added "${item.name}" to the post you're composing.`,
          type: "success",
        })
      );
    },
    [dispatch]
  );

  // Bulk version of onUseInPost — pushes every selected library item into
  // the editor's currentPost in one dispatch, then navigates. Used by the
  // selection-mode top bar's "Use in new post" button so the user can
  // build a carousel out of N library items in one tap. Selection is
  // cleared so re-entering the library doesn't appear "stuck" selected.
  const onBulkUseInPost = useCallback(() => {
    if (!selectedIds.size) return;
    const all = normalizedItems.filter((it) => selectedIds.has(it.id));
    const payload = all
      .filter((it) => it.remoteUrl || it.previewUrl)
      .map((item) => ({
        id: `lib_${Date.now()}_${useSeq.current++}`,
        name: item.name,
        kind: item.kind || "image",
        previewUrl: item.remoteUrl || item.previewUrl || null,
        remoteUrl: item.remoteUrl || null,
        status: "uploaded",
        filename: (item.id || item.name || "").split("/").pop(),
      }));
    if (!payload.length) {
      dispatch(
        addNotification({
          message: "Selected items have no usable URL — try re-uploading.",
          type: "error",
        })
      );
      return;
    }
    dispatch(addMedia(payload));
    dispatch(setActiveView("creation"));
    dispatch(
      addNotification({
        message: `Added ${payload.length} item${payload.length === 1 ? "" : "s"} to the post you're composing.`,
        type: "success",
      })
    );
    setSelectedIds(new Set());
  }, [selectedIds, normalizedItems, dispatch]);

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
                    // Surface the actual reason (size / auth / network)
                    // instead of always saying "Backend offline".
                    error:
                      result.status === "uploaded"
                        ? null
                        : result.error || "Upload failed",
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

  const handleDelete = useCallback(async (item) => {
    if (!window.confirm(`Delete "${item.name}"? This cannot be undone.`)) return;

    // Session-only items (upload still in progress, or backend offline): just drop locally.
    const isRemote = !!item.remoteUrl || /^[^_].*\.[a-z0-9]+$/i.test(item.id || "");
    if (!isRemote) {
      setUploads((prev) => prev.filter((u) => u.id !== item.id));
      return;
    }

    // Optimistic: mark as deleting, then either remove or restore on failure.
    setUploads((prev) =>
      prev.map((u) => (u.id === item.id ? { ...u, status: "deleting" } : u))
    );
    setRemoteHits((prev) =>
      prev.map((h) => (h.id === item.id ? { ...h, status: "deleting" } : h))
    );

    // The backend path is the search `id` (content-dir-relative). For
    // session uploads we don't have that, so fall back to filename.
    const backendPath = item.id?.includes("/") || /\.[a-z0-9]+$/i.test(item.id || "")
      ? item.id
      : item.name;

    const { ok, status } = await deleteFromBackend(backendPath);
    if (!ok && status !== 404) {
      setUploads((prev) =>
        prev.map((u) => (u.id === item.id ? { ...u, status: "uploaded" } : u))
      );
      setRemoteHits((prev) =>
        prev.map((h) => (h.id === item.id ? { ...h, status: "uploaded" } : h))
      );
      window.alert(`Couldn't delete "${item.name}" (HTTP ${status || "?"}).`);
      return;
    }

    setUploads((prev) => prev.filter((u) => u.id !== item.id));
    setRemoteHits((prev) => prev.filter((h) => h.id !== item.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    // Re-fetch so anything beyond the search page limit becomes visible
    // (without this, deleting all currently-shown items can make the
    // grid look empty even when more exist on disk).
    try {
      const hits = await listMedia(query.trim());
      setRemoteHits(hits);
    } catch {
      /* listing is best-effort — the optimistic drop already happened */
    }
  }, [query]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} item(s)? This cannot be undone.`)) return;

    // Optimistically mark as deleting
    setUploads((prev) => prev.map((u) => (selectedIds.has(u.id) ? { ...u, status: "deleting" } : u)));
    setRemoteHits((prev) => prev.map((h) => (selectedIds.has(h.id) ? { ...h, status: "deleting" } : h)));

    // Gather all selected items from the normalized list (which carries
    // the consistent `id`/`name`/`remoteUrl` shape both the optimistic
    // marker and the backend deletion need).
    const itemsToDelete = normalizedItems.filter((it) => selectedIds.has(it.id));

    // Process in parallel
    await Promise.all(
      itemsToDelete.map(async (item) => {
        const isRemote = !!item.remoteUrl || /^[^_].*\.[a-z0-9]+$/i.test(item.id || "");
        if (!isRemote) return; // Only exists locally (e.g. upload failed)

        const backendPath = item.id?.includes("/") || /\.[a-z0-9]+$/i.test(item.id || "")
          ? item.id
          : item.name;

        await deleteFromBackend(backendPath);
      })
    );

    // Drop them from the UI (ignoring individual errors to keep it simple, since if one fails it will just reappear on next refresh)
    setUploads((prev) => prev.filter((u) => !selectedIds.has(u.id)));
    setRemoteHits((prev) => prev.filter((h) => !selectedIds.has(h.id)));
    setSelectedIds(new Set());
    // Same reason as the single-delete path: the next batch of media on
    // disk (beyond the search-result page) only surfaces if we re-list.
    try {
      const hits = await listMedia(query.trim());
      setRemoteHits(hits);
    } catch {
      /* swallow — the optimistic UI already reflects the deletes */
    }
  }, [selectedIds, normalizedItems, query]);

  // Displayed grid mirrors the normalizedItems memo above so bulk
  // handlers and the tile rendering can never disagree on shape.
  const items = tab === "uploads" ? normalizedItems : [];

  const isBrand = tab === "brand";
  const isAI = tab === "ai";

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ padding: 20 }}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && tab === "uploads" && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 mb-5 px-4 py-2.5 rounded-lg border shadow-sm sticky top-0 z-20"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--accent-primary)",
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-sm font-semibold"
              style={{ color: "var(--accent-primary)" }}
            >
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              onClick={selectAllVisible}
              className="text-xs hover:underline inline-flex items-center gap-1"
              style={{ color: "var(--text-secondary)" }}
              title="Select every uploaded item visible in this list"
            >
              <CheckCheck size={12} /> Select all
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-xs hover:underline inline-flex items-center gap-1"
              style={{ color: "var(--text-muted)" }}
            >
              <X size={12} /> Clear
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBulkUseInPost}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={{
                background: "var(--accent-primary)",
                color: "#fff",
              }}
              title="Add every selected item to the post you're composing"
            >
              <Wand2 size={14} /> Use in new post
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              style={{ background: "rgba(220, 38, 38, 0.1)", color: "#ef4444" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(220, 38, 38, 0.2)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(220, 38, 38, 0.1)")}
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      )}

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
                <Tile
                  key={it.id}
                  item={it}
                  onDelete={handleDelete}
                  onUse={onUseInPost}
                  usageCount={usageCountFor(it)}
                  selected={selectedIds.has(it.id)}
                  onToggleSelect={handleToggleSelect}
                  selectionMode={selectedIds.size > 0}
                />
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
          <p className="text-sm">No AI-generated assets yet</p>
        </div>
      )}

      {isBrand && (
        <div
          className="rounded-xl flex flex-col items-center justify-center text-center gap-2 py-16"
          style={{ background: "var(--bg-card)", border: "1px dashed var(--border-default)", color: "var(--text-muted)" }}
        >
          <Palette size={30} className="opacity-40" />
          <p className="text-sm">Brand Kit — logos, palette & fonts</p>
          <p className="text-xs">Configured in Settings</p>
        </div>
      )}
    </div>
  );
}
