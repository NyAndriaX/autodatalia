"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useTranslations } from "next-intl";
import { addMedia, updateMedia, removeMedia } from "../../store/editorSlice";
import { addNotification } from "../../store/uiSlice";
import {
  validateFile,
  toMediaItem,
  revokeMediaItem,
  uploadToBackend,
  ACCEPTED_TYPES,
} from "../../lib/uploadService";
import { listMedia } from "../../lib/searchService";
import { UploadCloud, X, Film, ImageIcon, Loader2, CheckCircle2, AlertCircle, FolderOpen, Search } from "lucide-react";

export default function MediaUploader() {
  const dispatch = useDispatch();
  const t = useTranslations("creation");
  const tCommon = useTranslations("common");
  const media = useSelector((s) => s.editor.currentPost.media);
  const [dragOver, setDragOver] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const inputRef = useRef(null);

  // Note: previewUrls outlive the component mount because `media` lives in
  // Redux and the editor view can unmount/remount while items remain in
  // state. Per-item revocation happens in `handleRemove`; bulk revocation
  // for `clearMedia` / `resetEditor` should be done at the action lifecycle
  // (middleware) rather than in this component's unmount.

  const ingest = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const accepted = [];
      for (const file of files) {
        const err = validateFile(file);
        if (err) {
          dispatch(addNotification({ messageKey: "uploadRejected", messageParams: { name: file.name, error: err }, type: "error" }));
          continue;
        }
        accepted.push({ file, item: toMediaItem(file) });
      }
      if (!accepted.length) return;

      dispatch(addMedia(accepted.map((a) => a.item)));

      // Attempt backend upload in the background; preview works regardless.
      accepted.forEach(async ({ file, item }) => {
        dispatch(updateMedia({ id: item.id, patch: { status: "uploading" } }));
        const result = await uploadToBackend(file);
        dispatch(updateMedia({ id: item.id, patch: result }));
      });
    },
    [dispatch]
  );

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      ingest(e.dataTransfer.files);
    },
    [ingest]
  );

  const handleRemove = (item) => {
    revokeMediaItem(item);
    dispatch(removeMedia(item.id));
  };

  return (
    <div>
      <p
        className="text-xs font-semibold uppercase tracking-wider mb-3"
        style={{ color: "var(--text-tertiary)" }}
        id="media-uploader-label"
      >
        {t("media")}
      </p>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-labelledby="media-uploader-label"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="flex flex-col items-center justify-center gap-2 rounded-xl px-4 py-7 text-center cursor-pointer transition-all duration-200"
        style={{
          background: dragOver ? "rgba(29, 63, 190, 0.10)" : "var(--bg-tertiary)",
          border: dragOver
            ? "2px dashed var(--accent-primary)"
            : "2px dashed var(--border-default)",
          color: "var(--text-muted)",
        }}
      >
        <UploadCloud size={26} style={{ color: dragOver ? "var(--accent-primary)" : undefined }} aria-hidden="true" />
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>{t("clickToUpload")}</span>{" "}
          {t("orDragDrop")}
        </p>
        <p className="text-[11px]">{t("uploadFormats")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => {
            ingest(e.target.files);
            e.target.value = "";
          }}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {/* Or pick something already in the library (CEO #7) */}
      <button
        type="button"
        onClick={() => setShowLibrary(true)}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold"
        style={{ color: "var(--accent-primary)", background: "none", border: "none", cursor: "pointer" }}
      >
        <FolderOpen size={13} aria-hidden="true" /> {t("useFromLibrary")}
      </button>

      {showLibrary && (
        <LibraryPicker
          existing={new Set(media.map((m) => m.id))}
          onClose={() => setShowLibrary(false)}
        />
      )}

      {/* Thumbnails */}
      {media.length > 0 && (
        <ul className="grid grid-cols-4 gap-2 mt-3" aria-label={t("uploadedMediaListAria")}>
          {media.map((item) => (
            <li
              key={item.id}
              className="relative group rounded-lg overflow-hidden"
              style={{ aspectRatio: "1 / 1", background: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}
            >
              {item.kind === "video" ? (
                <video
                  src={item.remoteUrl || item.previewUrl}
                  className="w-full h-full object-cover"
                  muted
                  onError={(e) => {
                    if (item.previewUrl && e.currentTarget.src !== item.previewUrl) {
                      e.currentTarget.src = item.previewUrl;
                    }
                  }}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.remoteUrl || item.previewUrl}
                  alt={item.name}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    if (item.previewUrl && e.currentTarget.src !== item.previewUrl) {
                      e.currentTarget.src = item.previewUrl;
                    }
                  }}
                />
              )}

              {/* status chip — must distinguish 4 states with VISIBLE
                  difference, not just a tooltip:
                    uploading → spinner
                    uploaded  → green check
                    error/local (upload failed) → red alert + full-tile
                                overlay so the user can't miss it
                    initial   → kind icon */}
              {(item.status === "error" || item.status === "local") && (
                <div
                  className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold px-2 text-center pointer-events-none"
                  style={{ background: "rgba(220,38,38,0.65)", color: "#fff" }}
                >
                  {item.error || t("uploadFailedReadd")}
                </div>
              )}
              <span
                className="absolute top-1 left-1 flex items-center justify-center w-5 h-5 rounded-full"
                style={{
                  background:
                    item.status === "error" || item.status === "local"
                      ? "rgba(220,38,38,0.95)"
                      : "rgba(0,0,0,0.55)",
                }}
                title={
                  item.status === "uploading"
                    ? item.kind === "video"
                      ? tCommon("uploadingOptimizing")
                      : tCommon("uploading")
                    : item.status === "uploaded"
                    ? t("uploadedReady")
                    : item.status === "error" || item.status === "local"
                    ? t("uploadFailedDetail", { error: item.error || tCommon("unknownError") })
                    : item.status
                }
              >
                {item.status === "uploading" ? (
                  <Loader2 size={11} className="animate-spin text-white" />
                ) : item.status === "uploaded" ? (
                  <CheckCircle2 size={11} className="text-white" />
                ) : item.status === "error" || item.status === "local" ? (
                  <AlertCircle size={11} className="text-white" />
                ) : item.kind === "video" ? (
                  <Film size={11} className="text-white" />
                ) : (
                  <ImageIcon size={11} className="text-white" />
                )}
              </span>

              <button
                onClick={() => handleRemove(item)}
                className="absolute top-1 right-1 flex items-center justify-center w-5 h-5 rounded-full opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                style={{ background: "var(--status-error)" }}
                aria-label={t("removeMediaAria", { name: item.name })}
              >
                <X size={11} className="text-white" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Library picker (CEO #7: upload OR pick from the library) ────────────
   Lists the workspace's already-uploaded media (via /search → listMedia) and
   adds the selected items to the editor as already-"uploaded" descriptors
   (remoteUrl + filename already point at the server copy). */
function LibraryPicker({ existing, onClose }) {
  const t = useTranslations("creation");
  const tCommon = useTranslations("common");
  const dispatch = useDispatch();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState(null); // null = loading
  const [selected, setSelected] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    const handle = setTimeout(
      () => {
        // Show the loading state once the debounced search actually starts.
        setItems(null);
        listMedia(query)
          .then((rows) => alive && setItems(Array.isArray(rows) ? rows : []))
          .catch(() => alive && setItems([]));
      },
      query ? 250 : 0
    );
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [query]);

  const toggle = (id) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const add = () => {
    const chosen = (items || []).filter((h) => selected.has(h.id));
    const descriptors = chosen
      .map((h) => ({
        id: `lib-${h.id}`,
        name: h.title || h.id,
        kind: h.kind === "video" ? "video" : "image",
        previewUrl: h.url,
        remoteUrl: h.url,
        status: "uploaded",
        filename: h.id,
      }))
      .filter((d) => !existing.has(d.id));
    if (descriptors.length) dispatch(addMedia(descriptors));
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
          <h3 className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("libraryPickerTitle")}</h3>
          <button onClick={onClose} aria-label={tCommon("close")} style={{ color: "var(--text-secondary)", background: "none", border: "none", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <div className="shrink-0 px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5" style={{ background: "var(--bg-tertiary)", border: "1px solid var(--border-default)" }}>
            <Search size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("librarySearchPlaceholder")}
              className="flex-1 bg-transparent text-xs outline-none"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {items === null ? (
            <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>{t("libraryPickerLoading")}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: "var(--text-muted)" }}>{t("libraryPickerEmpty")}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {items.map((h) => {
                const on = selected.has(h.id);
                return (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => toggle(h.id)}
                      className="relative w-full overflow-hidden rounded-lg"
                      style={{
                        aspectRatio: "1 / 1",
                        border: on ? "2px solid var(--accent-primary)" : "1px solid var(--border-default)",
                        background: "var(--bg-elevated)",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {h.kind === "video" ? (
                        <video src={h.url} className="h-full w-full object-cover" muted />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={h.url} alt={h.title || ""} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      )}
                      {on && (
                        <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full" style={{ background: "var(--accent-primary)" }}>
                          <CheckCircle2 size={12} className="text-white" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 px-4 py-3" style={{ borderTop: "1px solid var(--border-default)" }}>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)", border: "1px solid var(--border-default)", cursor: "pointer" }}
          >
            {tCommon("cancel")}
          </button>
          <button
            onClick={add}
            disabled={selected.size === 0}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-white"
            style={{
              background: selected.size ? "var(--accent-primary)" : "var(--bg-secondary)",
              opacity: selected.size ? 1 : 0.5,
              cursor: selected.size ? "pointer" : "not-allowed",
              border: "none",
            }}
          >
            {t("libraryPickerAdd", { n: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
