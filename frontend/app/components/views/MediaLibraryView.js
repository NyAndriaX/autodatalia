"use client";

import { btnPrimary, btnSecondary, btnGhost, fadeIn } from "../../lib/uiClasses";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslations } from "next-intl";
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
  Grid3X3,
  HardDrive,
  Loader2,
  FileText,
  Pencil,
} from "lucide-react";
import { listMedia } from "../../lib/searchService";
import { fetchPosts, deletePost } from "../../lib/postsService";
import {
  ACCEPTED_TYPES,
  MAX_SIZE_BYTES,
  deleteFromBackend,
  uploadToBackend,
  validateFile,
} from "../../lib/uploadService";
import { addMedia, loadDraft } from "../../store/editorSlice";
import { addNotification, setActiveView } from "../../store/uiSlice";

const TABS = [
  { id: "uploads", labelKey: "tabFiles", icon: ImageIcon, descKey: "tabFilesDesc" },
  { id: "ai", labelKey: "tabAi", icon: Sparkles, descKey: "tabAiDesc" },
  { id: "drafts", labelKey: "tabDrafts", icon: FileText, descKey: "tabDraftsDesc" },
];

const TYPE_FILTERS = [
  { id: "all", labelKey: "filterAll" },
  { id: "image", labelKey: "filterImages" },
  { id: "video", labelKey: "filterVideos" },
];

const MAX_MB = Math.round(MAX_SIZE_BYTES / 1024 / 1024);

/* ─── Tuile média ────────────────────────────────────────────────────── */
function MediaTile({
  item,
  onDelete,
  onUse,
  usageCount = 0,
  selected,
  onToggleSelect,
  selectionMode,
}) {
  const t = useTranslations("library");
  const tCommon = useTranslations("common");
  const Icon = item.kind === "video" ? Film : ImageIcon;
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
      className={`group relative overflow-hidden flex items-center justify-center transition-all duration-200 ${
        canSelect ? "cursor-pointer" : ""
      } ${selected ? "ring-2 ring-[var(--accent-primary)] ring-offset-2 ring-offset-[var(--bg-primary)]" : ""}`}
      style={{
        aspectRatio: "1 / 1",
        borderRadius: 14,
        background: hasImagePreview
          ? `center / cover no-repeat url(${previewSrc})`
          : "var(--bg-secondary)",
        border: selected
          ? "2px solid var(--accent-primary)"
          : "1px solid var(--border-default)",
        boxShadow: selected ? "var(--accent-glow)" : "var(--shadow-sm)",
      }}
      title={item.name}
      onClick={() => {
        if (selectionMode && canSelect) onToggleSelect(item);
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
        <div className="flex flex-col items-center gap-2 opacity-40">
          <Icon size={26} style={{ color: "var(--text-muted)" }} />
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {isVideo ? t("videoBadge") : t("imageBadge")}
          </span>
        </div>
      )}

      {/* Checkbox sélection */}
      {canSelect && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(item);
          }}
          aria-label={selected ? t("deselectItem", { name: item.name }) : t("selectItem", { name: item.name })}
          aria-pressed={!!selected}
          className={`absolute top-2 left-2 z-10 w-6 h-6 inline-flex items-center justify-center rounded-lg transition-all ${
            selected || selectionMode
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
          }`}
          style={{
            background: selected ? "var(--accent-primary)" : "rgba(17, 19, 26, 0.55)",
            border: selected ? "none" : "1.5px solid rgba(255,255,255,0.6)",
            backdropFilter: selected ? "none" : "blur(4px)",
          }}
        >
          {selected && <Check size={13} color="#fff" strokeWidth={3} />}
        </button>
      )}

      {/* Badges haut-gauche */}
      <div
        className={`absolute left-2 flex flex-col items-start gap-1 pointer-events-none ${
          canSelect ? "top-9" : "top-2"
        }`}
      >
        {isVideo && (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded-md"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
            title={t("videoBadge")}
          >
            <Film size={11} className="text-white" />
          </span>
        )}
        {usageCount > 0 && (
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
            style={{
              background: "var(--accent-primary)",
              color: "#fff",
              backdropFilter: "blur(4px)",
            }}
            title={t("usageBadge", { n: usageCount })}
          >
            <CalendarClock size={9} />
            {usageCount}
          </span>
        )}
      </div>

      {/* Supprimer */}
      {canDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:scale-105"
          style={{
            background: "rgba(17,19,26,0.65)",
            color: "#fff",
            border: "1px solid rgba(255,255,255,0.12)",
            backdropFilter: "blur(4px)",
          }}
          aria-label={t("deleteItem", { name: item.name })}
          title={tCommon("delete")}
        >
          <Trash2 size={13} />
        </button>
      )}

      {/* Action au survol */}
      {canUse && !selectionMode && (
        <div
          className="absolute inset-0 flex items-end justify-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          style={{
            background: "linear-gradient(to top, rgba(17,19,26,0.82) 0%, transparent 60%)",
          }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onUse(item);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 mb-2.5 rounded-full text-xs font-semibold transition-transform hover:scale-105"
            style={{
              background: "var(--accent-primary)",
              color: "#fff",
              boxShadow: "var(--shadow-md)",
            }}
            title={t("addToNewPost")}
          >
            <Wand2 size={12} />
            {t("use")}
          </button>
        </div>
      )}

      {/* États de chargement / erreur */}
      {item.status === "uploading" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs"
          style={{ background: "rgba(17,19,26,0.6)", color: "#fff" }}
        >
          <Loader2 size={18} className="animate-spin" />
          {t("uploading")}
        </div>
      )}
      {item.status === "deleting" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs"
          style={{ background: "rgba(17,19,26,0.6)", color: "#fff" }}
        >
          {t("deleting")}
        </div>
      )}
      {item.status === "error" && (
        <div
          className="absolute inset-0 flex items-center justify-center text-xs px-3 text-center"
          style={{ background: "rgba(220,38,38,0.7)", color: "#fff" }}
        >
          {item.error || t("uploadFailed")}
        </div>
      )}

      {/* Nom du fichier */}
      <span
        className="absolute bottom-0 inset-x-0 px-2.5 py-1.5 text-[10px] font-medium truncate"
        style={{
          background: "linear-gradient(to top, rgba(17,19,26,0.75), transparent)",
          color: "#fff",
        }}
      >
        {item.name}
      </span>
    </div>
  );
}

/* ─── Zone de dépôt ────────────────────────────────────────────────────── */
function DropZone({ onFiles, searching, hasItems, fileInputRef, onFileChange }) {
  const t = useTranslations("library");
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(Array.from(e.dataTransfer.files || [])); }}
      onClick={() => fileInputRef.current?.click()}
      className="flex flex-col items-center justify-center text-center gap-3 py-14 px-6 cursor-pointer transition-all duration-200"
      style={{
        borderRadius: 16,
        background: dragOver ? "rgba(91,91,214,0.06)" : "var(--bg-card)",
        border: dragOver
          ? "2px dashed var(--accent-primary)"
          : "2px dashed var(--border-default)",
        boxShadow: dragOver ? "var(--accent-glow)" : "none",
      }}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: "rgba(91,91,214,0.10)", color: "var(--accent-primary)" }}
      >
        {searching ? <Loader2 size={26} className="animate-spin" /> : <UploadCloud size={26} />}
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {searching
            ? t("searching")
            : hasItems
              ? t("dropMoreFiles")
              : t("dropFilesHere")}
        </p>
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("orBrowseMax", { mb: MAX_MB })}
        </p>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        multiple
        hidden
        onChange={onFileChange}
      />
    </div>
  );
}

/* ─── État vide générique ──────────────────────────────────────────────── */
function EmptyPanel({ icon: Icon, title, subtitle, action }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center gap-4 py-20 px-6"
      style={{
        borderRadius: 16,
        background: "var(--bg-card)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}
      >
        <Icon size={26} />
      </div>
      <div>
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</p>
        {subtitle && (
          <p className="mt-1 text-xs max-w-xs" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* ─── Vue principale ───────────────────────────────────────────────────── */
export default function MediaLibraryView() {
  const t = useTranslations("library");
  const tCommon = useTranslations("common");
  const dispatch = useDispatch();
  const scheduledPosts = useSelector((s) => s.calendar.scheduledPosts);
  const [tab, setTab] = useState("uploads");
  const [uploads, setUploads] = useState([]);
  const [remoteHits, setRemoteHits] = useState([]);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [dragging, setDragging] = useState(false);
  const [drafts, setDrafts] = useState(null); // null = loading

  const loadDrafts = useCallback(async () => {
    const posts = await fetchPosts();
    setDrafts(Array.isArray(posts) ? posts.filter((p) => p.status === "draft") : []);
  }, []);

  useEffect(() => {
    if (tab === "drafts") loadDrafts();
  }, [tab, loadDrafts]);

  const onEditDraft = (d) => {
    dispatch(loadDraft(d));
    dispatch(setActiveView("creation"));
  };

  const onDeleteDraft = async (id) => {
    const ok = await deletePost(id);
    if (ok) {
      setDrafts((list) => (list || []).filter((p) => p.id !== id));
      dispatch(addNotification({ message: t("draftDeleted"), type: "info" }));
    }
  };
  const fileInputRef = useRef(null);
  const seq = useRef(0);
  const useSeq = useRef(0);

  const normalizedItems = useMemo(() => {
    const sessionNames = new Set(uploads.map((u) => u.name));
    return [
      ...uploads,
      ...remoteHits
        .filter((h) => !sessionNames.has(h.title))
        .map((h) => ({
          id: h.id,
          kind: h.kind || (h.subtitle?.toLowerCase().includes("video") ? "video" : "image"),
          name: h.title,
          status: "uploaded",
          remoteUrl: h.url || null,
          previewUrl: null,
        })),
    ];
  }, [uploads, remoteHits]);

  const filteredItems = useMemo(() => {
    let list = normalizedItems;
    if (typeFilter !== "all") list = list.filter((it) => it.kind === typeFilter);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((it) => it.name?.toLowerCase().includes(q));
    }
    return list;
  }, [normalizedItems, typeFilter, query]);

  const stats = useMemo(() => {
    const images = normalizedItems.filter((it) => it.kind === "image").length;
    const videos = normalizedItems.filter((it) => it.kind === "video").length;
    const uploading = normalizedItems.filter((it) => it.status === "uploading").length;
    return { total: normalizedItems.length, images, videos, uploading };
  }, [normalizedItems]);

  const handleToggleSelect = useCallback((item) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of filteredItems) {
        if (it.status === "uploaded" || it.remoteUrl) next.add(it.id);
      }
      return next;
    });
  }, [filteredItems]);

  const usageByName = useMemo(() => {
    const counts = new Map();
    for (const post of scheduledPosts) {
      if (!Array.isArray(post.media)) continue;
      for (const m of post.media) {
        for (const k of [m.filename, m.name, m.remoteUrl].filter(Boolean)) {
          counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
    }
    return counts;
  }, [scheduledPosts]);

  const usageCountFor = useCallback(
    (item) => {
      let max = 0;
      for (const c of [item.name, item.id, item.remoteUrl].filter(Boolean)) {
        max = Math.max(max, usageByName.get(c) || 0);
      }
      return max;
    },
    [usageByName]
  );

  const onUseInPost = useCallback(
    (item) => {
      dispatch(
        addMedia([
          {
            id: `lib_${Date.now()}_${useSeq.current++}`,
            name: item.name,
            kind: item.kind || "image",
            previewUrl: item.remoteUrl || item.previewUrl || null,
            remoteUrl: item.remoteUrl || null,
            status: "uploaded",
            filename: (item.id || item.name || "").split("/").pop(),
          },
        ])
      );
      dispatch(setActiveView("creation"));
      dispatch(
        addNotification({
          message: t("addedToPost", { name: item.name }),
          type: "success",
        })
      );
    },
    [dispatch, t]
  );

  const onBulkUseInPost = useCallback(() => {
    if (!selectedIds.size) return;
    const payload = normalizedItems
      .filter((it) => selectedIds.has(it.id) && (it.remoteUrl || it.previewUrl))
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
      dispatch(addNotification({ message: t("noUsableUrl"), type: "error" }));
      return;
    }
    dispatch(addMedia(payload));
    dispatch(setActiveView("creation"));
    dispatch(
      addNotification({
        message: t("addedBulkToPost", { n: payload.length }),
        type: "success",
      })
    );
    setSelectedIds(new Set());
  }, [selectedIds, normalizedItems, dispatch, t]);

  useEffect(() => {
    if (tab !== "uploads") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      const hits = await listMedia(query.trim());
      if (!cancelled) {
        setRemoteHits(hits);
        setSearching(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, tab]);

  const handleFiles = useCallback(async (files) => {
    const items = [];
    for (const file of files) {
      const err = validateFile(file);
      const id = `u_${Date.now()}_${seq.current++}`;
      if (err) {
        items.push({ id, kind: file.type.startsWith("video/") ? "video" : "image", name: file.name, status: "error", error: err });
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
                    error: result.status === "uploaded" ? null : result.error || t("uploadFailed"),
                    remoteUrl: result.remoteUrl,
                  }
                : p
            )
          );
        })
    );
    const hits = await listMedia(query.trim());
    setRemoteHits(hits);
  }, [query, t]);

  const onFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) handleFiles(files);
  };

  const handleDelete = useCallback(async (item) => {
    if (!window.confirm(t("deleteConfirm", { name: item.name }))) return;

    const isRemote = !!item.remoteUrl || /^[^_].*\.[a-z0-9]+$/i.test(item.id || "");
    if (!isRemote) {
      setUploads((prev) => prev.filter((u) => u.id !== item.id));
      return;
    }

    setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: "deleting" } : u)));
    setRemoteHits((prev) => prev.map((h) => (h.id === item.id ? { ...h, status: "deleting" } : h)));

    const backendPath = item.id?.includes("/") || /\.[a-z0-9]+$/i.test(item.id || "") ? item.id : item.name;
    const { ok, status } = await deleteFromBackend(backendPath);

    if (!ok && status !== 404) {
      setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: "uploaded" } : u)));
      setRemoteHits((prev) => prev.map((h) => (h.id === item.id ? { ...h, status: "uploaded" } : h)));
      window.alert(t("deleteFailed", { name: item.name, status: status || "?" }));
      return;
    }

    setUploads((prev) => prev.filter((u) => u.id !== item.id));
    setRemoteHits((prev) => prev.filter((h) => h.id !== item.id));
    setSelectedIds((prev) => { const next = new Set(prev); next.delete(item.id); return next; });

    try {
      const hits = await listMedia(query.trim());
      setRemoteHits(hits);
    } catch { /* best-effort */ }
  }, [query, t]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(t("deleteBulkConfirm", { n: selectedIds.size }))) return;

    setUploads((prev) => prev.map((u) => (selectedIds.has(u.id) ? { ...u, status: "deleting" } : u)));
    setRemoteHits((prev) => prev.map((h) => (selectedIds.has(h.id) ? { ...h, status: "deleting" } : h)));

    const itemsToDelete = normalizedItems.filter((it) => selectedIds.has(it.id));
    await Promise.all(
      itemsToDelete.map(async (item) => {
        const isRemote = !!item.remoteUrl || /^[^_].*\.[a-z0-9]+$/i.test(item.id || "");
        if (!isRemote) return;
        const backendPath = item.id?.includes("/") || /\.[a-z0-9]+$/i.test(item.id || "") ? item.id : item.name;
        await deleteFromBackend(backendPath);
      })
    );

    setUploads((prev) => prev.filter((u) => !selectedIds.has(u.id)));
    setRemoteHits((prev) => prev.filter((h) => !selectedIds.has(h.id)));
    setSelectedIds(new Set());

    try {
      const hits = await listMedia(query.trim());
      setRemoteHits(hits);
    } catch { /* best-effort */ }
  }, [selectedIds, normalizedItems, query, t]);

  return (
    <div
      className={`h-full overflow-y-auto p-4 sm:p-6 ${fadeIn}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (tab === "uploads") handleFiles(Array.from(e.dataTransfer.files || []));
      }}
    >
      {/* ── En-tête ──────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1
            className="text-2xl font-extrabold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {t("pageTitle")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
            {t("pageSubtitle")}
          </p>
        </div>
        {tab === "uploads" && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className={`${btnPrimary} inline-flex items-center gap-2`}
          >
            <UploadCloud size={16} />
            {t("import")}
          </button>
        )}
      </div>

      {/* ── KPIs ─────────────────────────────────────────────────── */}
      {tab === "uploads" && (
        <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(140px, 100%), 1fr))" }}>
          {[
            { icon: HardDrive, label: t("statTotal"), value: stats.total, color: "var(--accent-primary)" },
            { icon: ImageIcon, label: t("statImages"), value: stats.images, color: "#E1306C" },
            { icon: Film, label: t("statVideos"), value: stats.videos, color: "#0891B2" },
            { icon: Loader2, label: t("statInProgress"), value: stats.uploading, color: "var(--status-pending)" },
          ].map(({ icon: Icon, label, value, color }) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-2xl p-4"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: color + "18", color }}
              >
                <Icon size={17} />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  {label}
                </p>
                <p className="text-xl font-extrabold leading-none" style={{ color: "var(--text-primary)" }}>
                  {value}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Barre de sélection multiple ──────────────────────────── */}
      {selectedIds.size > 0 && tab === "uploads" && (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-3 sticky top-0 z-20"
          style={{
            background: "var(--bg-elevated)",
            border: "1px solid var(--accent-primary)",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-bold" style={{ color: "var(--accent-primary)" }}>
              {t("selected", { n: selectedIds.size })}
            </span>
            <button
              type="button"
              onClick={selectAllVisible}
              className={`${btnGhost} text-xs inline-flex items-center gap-1`}
            >
              <CheckCheck size={13} /> {tCommon("selectAll")}
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className={`${btnGhost} text-xs inline-flex items-center gap-1`}
              style={{ color: "var(--text-muted)" }}
            >
              <X size={13} /> {tCommon("clear")}
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={onBulkUseInPost}
              className={`${btnPrimary} inline-flex items-center gap-2 text-sm py-2 px-4`}
            >
              <Wand2 size={14} /> {t("useInNewPost")}
            </button>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="inline-flex items-center gap-2 rounded-[10px] px-4 py-2 text-sm font-semibold transition-all"
              style={{ background: "var(--accent-red-soft)", color: "var(--accent-red)" }}
            >
              <Trash2 size={14} /> {tCommon("delete")}
            </button>
          </div>
        </div>
      )}

      {/* ── Onglets ──────────────────────────────────────────────── */}
      <div
        className="mb-5 flex gap-1 p-1 rounded-2xl w-fit max-w-full overflow-x-auto"
        style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-default)" }}
      >
        {TABS.map((tab_) => {
          const Icon = tab_.icon;
          const active = tab === tab_.id;
          return (
            <button
              key={tab_.id}
              onClick={() => setTab(tab_.id)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all duration-200"
              style={{
                background: active ? "var(--bg-card)" : "transparent",
                color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                boxShadow: active ? "var(--shadow-sm)" : "none",
              }}
            >
              <Icon size={15} />
              {t(tab_.labelKey)}
            </button>
          );
        })}
      </div>

      {/* ── Onglet Fichiers ──────────────────────────────────────── */}
      {tab === "uploads" && (
        <>
          {/* Filtres + recherche */}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1.5">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setTypeFilter(f.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: typeFilter === f.id ? "rgba(91,91,214,0.12)" : "var(--bg-secondary)",
                    color: typeFilter === f.id ? "var(--accent-primary)" : "var(--text-secondary)",
                    border: `1px solid ${typeFilter === f.id ? "rgba(91,91,214,0.25)" : "var(--border-default)"}`,
                  }}
                >
                  {t(f.labelKey)}
                </button>
              ))}
            </div>
            <div
              className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2 w-full sm:w-auto"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}
            >
              <Search size={14} style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="bg-transparent outline-none text-sm min-w-0 flex-1 sm:flex-none"
                style={{ color: "var(--text-primary)", width: "min(180px, 100%)" }}
              />
              {query && (
                <button type="button" onClick={() => setQuery("")} className={btnGhost} style={{ padding: 2 }}>
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Zone de dépôt (toujours visible en haut si peu d'items) */}
          {(filteredItems.length === 0 || dragging) && (
            <div className="mb-5">
              <DropZone
                onFiles={handleFiles}
                searching={searching}
                hasItems={filteredItems.length > 0}
                fileInputRef={fileInputRef}
                onFileChange={onFileChange}
              />
            </div>
          )}

          {/* Grille */}
          {filteredItems.length > 0 ? (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(140px, 100%), 1fr))" }}
            >
              {filteredItems.map((it) => (
                <MediaTile
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
          ) : !searching && !dragging ? (
            <EmptyPanel
              icon={Grid3X3}
              title={t("emptyTitle")}
              subtitle={query ? t("emptySearchSubtitle", { query }) : t("emptySubtitle")}
              action={
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`${btnSecondary} inline-flex items-center gap-2 text-sm`}
                >
                  <UploadCloud size={15} /> {t("importFile")}
                </button>
              }
            />
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(",")}
            multiple
            hidden
            onChange={onFileChange}
          />
        </>
      )}

      {/* ── Onglet IA ────────────────────────────────────────────── */}
      {tab === "ai" && (
        <EmptyPanel
          icon={Sparkles}
          title={t("noAi")}
          subtitle={t("noAiSubtitle")}
          action={
            <button
              type="button"
              onClick={() => dispatch(setActiveView("videos"))}
              className={`${btnSecondary} inline-flex items-center gap-2 text-sm`}
            >
              <Sparkles size={15} /> {t("generateAiVideo")}
            </button>
          }
        />
      )}

      {/* ── Onglet Brouillons (drafts) ───────────────────────────── */}
      {tab === "drafts" &&
        (drafts === null ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : drafts.length === 0 ? (
          <EmptyPanel icon={FileText} title={t("noDrafts")} subtitle={t("noDraftsSubtitle")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 rounded-xl p-3"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-default)" }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm" style={{ color: "var(--text-primary)" }}>
                    {d.content?.trim() ? d.content : <em style={{ color: "var(--text-muted)" }}>—</em>}
                  </p>
                  <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {Object.keys(d.platforms || {}).filter((k) => d.platforms[k]).join(", ")}
                    {d.scheduledDate ? ` · ${d.scheduledDate}` : ""}
                    {d.media?.length ? ` · ${d.media.length} media` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onEditDraft(d)}
                  className={`${btnSecondary} inline-flex shrink-0 items-center gap-1.5 text-xs`}
                >
                  <Pencil size={13} /> {t("draftEdit")}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteDraft(d.id)}
                  className="shrink-0 rounded-lg p-2"
                  title={t("draftDelete")}
                  aria-label={t("draftDelete")}
                  style={{ background: "rgba(239,68,68,.1)", color: "var(--status-error)", border: "none", cursor: "pointer" }}
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
