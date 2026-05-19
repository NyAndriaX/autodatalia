"use client";

import { useState } from "react";
import {
  UploadCloud,
  Sparkles,
  Palette,
  Image as ImageIcon,
  Film,
  Lock,
} from "lucide-react";

/* Skeleton — wires to plan tasks ME-T01/T02 (media tables + upload),
   ME-T03 / VD-T01..T04 (AI assets), TP-T03 (brand kit). No backend yet. */
const TABS = [
  { id: "uploads", label: "Uploads", icon: ImageIcon },
  { id: "ai", label: "AI-Generated", icon: Sparkles },
  { id: "brand", label: "Brand Kit", icon: Palette },
];

const MOCK = {
  uploads: Array.from({ length: 8 }, (_, i) => ({
    id: i,
    kind: i % 3 === 0 ? "video" : "image",
    name: `asset_${i + 1}.${i % 3 === 0 ? "mp4" : "jpg"}`,
  })),
  ai: Array.from({ length: 6 }, (_, i) => ({
    id: i,
    kind: i % 2 ? "video" : "image",
    name: i % 2 ? "ComfyUI / LTX clip" : "Diffusion render",
  })),
  brand: [],
};

function Tile({ item }) {
  const Icon = item.kind === "video" ? Film : ImageIcon;
  return (
    <div
      className="relative rounded-xl overflow-hidden flex items-center justify-center"
      style={{
        aspectRatio: "1 / 1",
        background: "linear-gradient(135deg, var(--bg-tertiary), var(--bg-elevated))",
        border: "1px solid var(--border-default)",
      }}
      title={item.name}
    >
      <Icon size={28} style={{ color: "var(--text-muted)", opacity: 0.5 }} />
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
  const items = MOCK[tab];

  return (
    <div className="h-full overflow-y-auto" style={{ padding: 20 }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-2">
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
        <button className="btn-primary inline-flex items-center gap-2">
          <UploadCloud size={16} />
          Upload media
        </button>
      </div>

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
          style={{ background: "var(--bg-card)", border: "1px dashed var(--border-default)", color: "var(--text-muted)" }}
        >
          <Palette size={30} className="opacity-40" />
          <p className="text-sm">Brand Kit — logos, palette & fonts</p>
          <p className="text-xs">Configured in Settings (TP-T03)</p>
        </div>
      )}

      <div
        className="mt-5 flex items-center gap-2 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <Lock size={12} />
        Skeleton view — assets are mocked until the media backend (ME-T0x / VD-T0x) is wired.
      </div>
    </div>
  );
}
