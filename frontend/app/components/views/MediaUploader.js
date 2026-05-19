"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { addMedia, updateMedia, removeMedia } from "../../store/editorSlice";
import { addNotification } from "../../store/uiSlice";
import {
  validateFile,
  toMediaItem,
  revokeMediaItem,
  uploadToBackend,
  ACCEPTED_TYPES,
} from "../../lib/uploadService";
import { UploadCloud, X, Film, ImageIcon, Loader2, CheckCircle2 } from "lucide-react";

export default function MediaUploader() {
  const dispatch = useDispatch();
  const media = useSelector((s) => s.editor.currentPost.media);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  // Revoke any remaining object URLs on unmount to avoid leaks.
  useEffect(() => {
    return () => media.forEach(revokeMediaItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingest = useCallback(
    (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const accepted = [];
      for (const file of files) {
        const err = validateFile(file);
        if (err) {
          dispatch(addNotification({ message: `${file.name}: ${err}`, type: "error" }));
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
        Media
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
          background: dragOver ? "rgba(59,130,246,0.10)" : "var(--bg-tertiary)",
          border: dragOver
            ? "2px dashed var(--accent-primary)"
            : "2px dashed var(--border-default)",
          color: "var(--text-muted)",
        }}
      >
        <UploadCloud size={26} style={{ color: dragOver ? "var(--accent-primary)" : undefined }} aria-hidden="true" />
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          <span style={{ color: "var(--accent-primary)", fontWeight: 600 }}>Click to upload</span>{" "}
          or drag &amp; drop
        </p>
        <p className="text-[11px]">PNG · JPG · GIF · WebP · MP4 · MOV — up to 50 MB</p>
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

      {/* Thumbnails */}
      {media.length > 0 && (
        <ul className="grid grid-cols-4 gap-2 mt-3" aria-label="Uploaded media">
          {media.map((item) => (
            <li
              key={item.id}
              className="relative group rounded-lg overflow-hidden"
              style={{ aspectRatio: "1 / 1", background: "var(--bg-elevated)", border: "1px solid var(--border-default)" }}
            >
              {item.kind === "video" ? (
                <video src={item.previewUrl} className="w-full h-full object-cover" muted />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt={item.name} className="w-full h-full object-cover" />
              )}

              {/* status chip */}
              <span
                className="absolute top-1 left-1 flex items-center justify-center w-5 h-5 rounded-full"
                style={{ background: "rgba(0,0,0,0.55)" }}
                title={item.status}
              >
                {item.status === "uploading" ? (
                  <Loader2 size={11} className="animate-spin text-white" />
                ) : item.status === "uploaded" ? (
                  <CheckCircle2 size={11} className="text-white" />
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
                aria-label={`Remove ${item.name}`}
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
