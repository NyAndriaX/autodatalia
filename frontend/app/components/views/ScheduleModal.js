"use client";
import { btnPrimary, btnSecondary, btnGhost, glassCard, fadeIn } from "../../lib/uiClasses";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { isoDateKey, startOfToday, parseDateKey } from "../../lib/dateUtils";
import { getScheduleTimezone } from "../../lib/timezone";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";

/**
 * Scheduling dialog — just a calendar + time (CEO: the planning step should be
 * only a calendar). The post's content, media, platforms and ratios are already
 * set in the editor that opens this, so this dialog only picks WHEN to publish
 * and forwards them untouched alongside the chosen date/time. `onSchedule`
 * receives a post object with `scheduledDate` so callers forward it straight to
 * the thunk.
 */
export default function ScheduleModal({
  initialDate = null,
  initialContent = "",
  initialPlatforms,
  initialTime = "09:00",
  initialMedia = [],
  initialRatios = null,
  initialTikTok = null,
  title,
  submitLabel,
  onClose,
  onSchedule,
}) {
  const t = useTranslations("scheduleModal");
  const tCommon = useTranslations("common");
  const [date, setDate] = useState(initialDate ?? isoDateKey(startOfToday()));
  const [time, setTime] = useState(initialTime ?? "09:00");

  const resolvedTitle = title ?? t("title");
  const resolvedSubmitLabel = submitLabel ?? tCommon("schedule");
  const hasPending = (initialMedia || []).some((m) => m.status === "uploading");
  const dayLabel = parseDateKey(date).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div
      className={`fixed inset-0 z-100 flex items-center justify-center p-4 ${fadeIn}`}
      style={{ background: "rgba(15, 23, 42, 0.45)" }}
      onClick={onClose}
    >
      <div
        className={`${glassCard} w-full p-4 sm:p-5`}
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-default)",
          maxWidth: "min(26rem, 95vw)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold" style={{ color: "var(--text-primary)" }}>
            {resolvedTitle}
          </h3>
          <button onClick={onClose} className={btnGhost} style={{ padding: 6 }} aria-label={tCommon("close")}>
            <X size={16} />
          </button>
        </div>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>{dayLabel}</p>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <DatePicker value={date} onChange={setDate} minKey={isoDateKey(startOfToday())} />
          <TimePicker value={time} onChange={setTime} />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            {tCommon("cancel")}
          </button>
          <button
            className={btnPrimary}
            disabled={hasPending}
            title={hasPending ? t("waitingForUpload") : undefined}
            onClick={() =>
              onSchedule({
                content: (initialContent || "").trim(),
                platforms: initialPlatforms ?? { facebook: true, instagram: true },
                scheduledDate: date,
                time,
                timezone: getScheduleTimezone(),
                media: initialMedia,
                ratios:
                  initialRatios && Object.keys(initialRatios).length ? initialRatios : undefined,
                tiktok: initialTikTok,
              })
            }
          >
            {hasPending ? tCommon("uploading") : resolvedSubmitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
