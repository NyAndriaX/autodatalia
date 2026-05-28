"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { useTranslations } from "next-intl";
import {
  Bot,
  Plus,
  Trash2,
  Save,
  Loader2,
  Power,
  PowerOff,
  Clock,
  ListChecks,
  X,
} from "lucide-react";
import {
  DEFAULT_AUTOMATION_RULE,
  listAutomationRules,
  createAutomationRule,
  updateAutomationRule,
  deleteAutomationRule,
} from "../../lib/automationService";
import { addNotification } from "../../store/uiSlice";
import { PLATFORMS, TONES } from "../../lib/platforms";
import TimePicker from "./TimePicker";

// Form option ids mirror the backend AutomationRule pydantic model.
// Labels are resolved at render time via useTranslations() so locale
// changes flip the segmented-control labels instantly.
const CONTENT_TYPE_IDS = ["photo", "video", "carousel", "template", "text"];
const OBJECTIVE_IDS = ["informative", "promotional", "engagement", "acquisition"];
const FREQUENCY_IDS = ["daily", "weekdays", "weekly", "monthly", "custom"];

const LEAD_PRESETS = [5, 30, 60];

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function summarizeSchedule(rule) {
  const s = rule.schedule || {};
  const times = (s.times || []).join(", ") || "—";
  switch (s.frequency) {
    case "daily":
      return `Daily at ${times}`;
    case "weekdays":
      return `${(s.weekdays || []).map((d) => WEEKDAY_LABELS[d]).join(", ") || "(no days)"} at ${times}`;
    case "weekly":
      return `Every ${WEEKDAY_LABELS[(s.weekdays || [])[0] ?? 0]} at ${times}`;
    case "monthly":
      return `Day(s) ${(s.month_days || []).join(", ") || "?"} at ${times}`;
    case "custom":
      return `Custom · ${times}`;
    default:
      return "—";
  }
}

function summarizeNumMedia(spec) {
  if (!spec) return "1";
  if (spec.mode === "range") return `${spec.min}–${spec.max} (AI picks)`;
  return `${spec.count}`;
}

// ── Form primitives ────────────────────────────────────────────────────
// SegmentedControl renders a row of pill buttons. Used wherever a short
// list of mutually-exclusive options would otherwise become a browser
// <select> — content type, objective, frequency, num_media mode. Visually
// echoes the platform/weekday chips elsewhere in the editor so the form
// feels of-a-piece with the rest of the app.

function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 p-1 rounded-lg"
      style={{ background: "var(--bg-tertiary)" }}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: active ? "var(--accent-primary)" : "transparent",
              color: active ? "white" : "var(--text-secondary)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      <div
        className="block text-xs font-semibold uppercase tracking-wider mb-1.5"
        style={{ color: "var(--text-tertiary)" }}
      >
        {label}
      </div>
      {children}
      {hint && (
        <div
          className="text-[11px] mt-1"
          style={{ color: "var(--text-muted)" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

export default function AutomationView() {
  const dispatch = useDispatch();
  const t = useTranslations("automation");
  const tCommon = useTranslations("common");
  // Translated segmented-control options. Built inside the component so
  // a locale flip re-renders the labels without remounting.
  const CONTENT_TYPES = useMemo(
    () =>
      CONTENT_TYPE_IDS.map((id) => ({
        id,
        label: t(id === "text" ? "textOnly" : id),
      })),
    [t]
  );
  const OBJECTIVES = useMemo(
    () => OBJECTIVE_IDS.map((id) => ({ id, label: t(id) })),
    [t]
  );
  const FREQUENCIES = useMemo(
    () =>
      FREQUENCY_IDS.map((id) => ({
        id,
        label: t(id === "weekdays" ? "specificDays" : id === "custom" ? "custom" : id),
      })),
    [t]
  );
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null); // null = no edit; "new" = create form
  const [draft, setDraft] = useState(DEFAULT_AUTOMATION_RULE);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listAutomationRules();
      setRules(items);
    } catch (err) {
      dispatch(
        addNotification({
          message: `Couldn't load automation rules: ${err.message}`,
          type: "error",
        })
      );
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = useMemo(
    () =>
      selectedId && selectedId !== "new"
        ? rules.find((r) => r.id === selectedId) || null
        : null,
    [selectedId, rules]
  );

  useEffect(() => {
    if (selectedId === "new") {
      setDraft({ ...DEFAULT_AUTOMATION_RULE, name: t("newRuleDraftName") });
    } else if (selected) {
      // Merge with defaults so older saved rules with missing fields don't crash the form.
      setDraft({ ...DEFAULT_AUTOMATION_RULE, ...selected });
    }
  }, [selectedId, selected]);

  const updateDraft = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const updateSchedule = (patch) =>
    setDraft((d) => ({ ...d, schedule: { ...d.schedule, ...patch } }));

  const updateNumMedia = (patch) =>
    setDraft((d) => ({ ...d, num_media: { ...d.num_media, ...patch } }));

  const togglePlatform = (id) =>
    setDraft((d) => ({
      ...d,
      platforms: { ...d.platforms, [id]: !d.platforms?.[id] },
    }));

  const toggleWeekday = (day) => {
    const current = draft.schedule?.weekdays || [];
    const next = current.includes(day)
      ? current.filter((x) => x !== day)
      : [...current, day].sort((a, b) => a - b);
    updateSchedule({ weekdays: next });
  };

  const updateTimeAt = (idx, value) => {
    const next = [...(draft.schedule?.times || [])];
    next[idx] = value;
    updateSchedule({ times: next });
  };

  const addTime = () =>
    updateSchedule({ times: [...(draft.schedule?.times || []), "12:00"] });

  const removeTime = (idx) =>
    updateSchedule({
      times: (draft.schedule?.times || []).filter((_, i) => i !== idx),
    });

  const handleSave = async () => {
    if (!draft.name?.trim()) {
      dispatch(
        addNotification({ message: t("ruleNameRequired"), type: "error" })
      );
      return;
    }
    setSaving(true);
    try {
      if (selectedId === "new") {
        const created = await createAutomationRule(draft);
        await refresh();
        dispatch(
          addNotification({
            message: `Rule created: ${created.name}`,
            type: "success",
          })
        );
      } else if (selected) {
        await updateAutomationRule(selected.id, draft);
        await refresh();
        dispatch(
          addNotification({ message: t("ruleUpdated"), type: "success" })
        );
      }
      // Close the editor on successful save — the list now reflects the
      // saved state and a fresh save shouldn't keep the form expanded.
      setSelectedId(null);
    } catch (err) {
      dispatch(
        addNotification({ message: `Save failed: ${err.message}`, type: "error" })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (rule) => {
    try {
      await updateAutomationRule(rule.id, { ...rule, active: !rule.active });
      refresh();
    } catch (err) {
      dispatch(addNotification({ message: `Failed: ${err.message}`, type: "error" }));
    }
  };

  const handleDelete = async (rule) => {
    if (!window.confirm(`Delete the rule "${rule.name}"?`)) return;
    try {
      await deleteAutomationRule(rule.id);
      if (selectedId === rule.id) setSelectedId(null);
      refresh();
      dispatch(addNotification({ message: t("ruleDeleted"), type: "success" }));
    } catch (err) {
      dispatch(addNotification({ message: `Failed: ${err.message}`, type: "error" }));
    }
  };

  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-lg"
              style={{ background: "var(--accent-gradient)" }}
            >
              <Bot size={22} color="white" />
            </div>
            <div>
              <h1
                className="text-xl font-bold leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {t("title")}
              </h1>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {t("subtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSelectedId("new")}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus size={16} /> {t("newRule")}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px,1fr] gap-4">
          {/* List */}
          <aside className="card" style={{ padding: 12 }}>
            {loading && (
              <div
                className="text-xs flex items-center gap-2 px-2 py-3"
                style={{ color: "var(--text-muted)" }}
              >
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            )}
            {!loading && rules.length === 0 && (
              <div
                className="text-xs px-2 py-6 text-center"
                style={{ color: "var(--text-muted)" }}
              >
                {t("noRules")}
              </div>
            )}
            <ul className="flex flex-col gap-1">
              {rules.map((r) => {
                const isActive = selectedId === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.id)}
                      className="w-full text-left p-3 rounded-lg transition-colors"
                      style={{
                        background: isActive
                          ? "rgba(99, 102, 241, 0.12)"
                          : "transparent",
                        border: `1px solid ${
                          isActive
                            ? "var(--accent-primary)"
                            : "var(--border-default)"
                        }`,
                      }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span
                          className="text-sm font-semibold truncate"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {r.name}
                        </span>
                        <span
                          className="shrink-0 w-2 h-2 rounded-full mt-1.5"
                          style={{
                            background: r.active
                              ? "var(--status-published)"
                              : "var(--text-muted)",
                          }}
                          title={r.active ? t("active") : t("inactive")}
                        />
                      </div>
                      <div
                        className="flex items-center gap-1 text-[11px] mt-1"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <Clock size={10} />
                        <span className="truncate">{summarizeSchedule(r)}</span>
                      </div>
                      <div
                        className="flex items-center gap-1 text-[11px] mt-0.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <ListChecks size={10} />
                        {r.content_type} · {summarizeNumMedia(r.num_media)} media
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* Editor */}
          <section className="card" style={{ padding: 20, minHeight: 400 }}>
            {!selectedId ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-12">
                <Bot
                  size={36}
                  style={{ color: "var(--text-muted)" }}
                  className="mb-3"
                />
                <p
                  className="text-sm font-medium mb-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Select a rule or create one
                </p>
                <p
                  className="text-xs max-w-md"
                  style={{ color: "var(--text-muted)" }}
                >
                  Rules define what kind of content to generate, on what
                  schedule, and how to gate it through Telegram validation.
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2
                    className="text-base font-bold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {selectedId === "new" ? t("newRule") : draft.name}
                  </h2>
                  <div className="flex items-center gap-2">
                    {selected && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(selected)}
                          className="btn-secondary text-xs inline-flex items-center gap-1"
                          title={selected.active ? t("deactivate") : t("activate")}
                        >
                          {selected.active ? (
                            <>
                              <PowerOff size={13} /> Deactivate
                            </>
                          ) : (
                            <>
                              <Power size={13} /> Activate
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(selected)}
                          className="btn-secondary text-xs inline-flex items-center gap-1"
                          style={{ color: "var(--status-error)" }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="btn-secondary text-xs inline-flex items-center gap-1"
                      title={tCommon("close")}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
                  <div>
                    <Field label={t("ruleName")}>
                      <input
                        type="text"
                        className="input-field"
                        value={draft.name}
                        onChange={(e) => updateDraft({ name: e.target.value })}
                        placeholder={t("namePlaceholder")}
                      />
                    </Field>

                    <Field label={t("contentType")}>
                      <SegmentedControl
                        options={CONTENT_TYPES}
                        value={draft.content_type}
                        onChange={(v) => updateDraft({ content_type: v })}
                        ariaLabel={t("contentType")}
                      />
                    </Field>

                    <Field
                      label={t("numMedia")}
                      hint="Fixed = always N. Range = AI picks within [min, max]."
                    >
                      <div className="mb-2">
                        <SegmentedControl
                          options={[
                            { id: "fixed", label: "Fixed" },
                            { id: "range", label: "Range" },
                          ]}
                          value={draft.num_media?.mode || "fixed"}
                          onChange={(v) => updateNumMedia({ mode: v })}
                          ariaLabel={t("numMedia")}
                        />
                      </div>
                      {draft.num_media?.mode === "fixed" ? (
                        <input
                          type="number"
                          min={1}
                          max={10}
                          className="input-field"
                          style={{ width: 96 }}
                          value={draft.num_media?.count ?? 1}
                          onChange={(e) =>
                            updateNumMedia({ count: parseInt(e.target.value || 1, 10) })
                          }
                        />
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={10}
                            className="input-field"
                            style={{ width: 76 }}
                            value={draft.num_media?.min ?? 2}
                            onChange={(e) =>
                              updateNumMedia({ min: parseInt(e.target.value || 1, 10) })
                            }
                          />
                          <span
                            className="text-xs"
                            style={{ color: "var(--text-muted)" }}
                          >
                            to
                          </span>
                          <input
                            type="number"
                            min={1}
                            max={10}
                            className="input-field"
                            style={{ width: 76 }}
                            value={draft.num_media?.max ?? 4}
                            onChange={(e) =>
                              updateNumMedia({ max: parseInt(e.target.value || 1, 10) })
                            }
                          />
                        </div>
                      )}
                    </Field>

                    <Field label="Domain / topic">
                      <input
                        type="text"
                        className="input-field"
                        value={draft.domain}
                        onChange={(e) => updateDraft({ domain: e.target.value })}
                        placeholder={t("domainPlaceholder")}
                      />
                    </Field>

                    <Field label={t("audience")}>
                      <input
                        type="text"
                        className="input-field"
                        value={draft.target_audience}
                        onChange={(e) =>
                          updateDraft({ target_audience: e.target.value })
                        }
                        placeholder={t("audiencePlaceholder")}
                      />
                    </Field>

                    <Field label="Tone">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateDraft({ tone: "" })}
                          className="text-xs font-medium px-3 py-1.5 rounded-md"
                          style={{
                            background:
                              !draft.tone
                                ? "var(--accent-primary)"
                                : "var(--bg-tertiary)",
                            color:
                              !draft.tone ? "white" : "var(--text-secondary)",
                          }}
                        >
                          Auto
                        </button>
                        {TONES.map((t) => {
                          const active = draft.tone === t.id;
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => updateDraft({ tone: t.id })}
                              className="text-xs font-medium px-3 py-1.5 rounded-md"
                              title={t.hint}
                              style={{
                                background: active
                                  ? "var(--accent-primary)"
                                  : "var(--bg-tertiary)",
                                color: active
                                  ? "white"
                                  : "var(--text-secondary)",
                              }}
                            >
                              {t.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>

                    <Field label={t("objective")}>
                      <SegmentedControl
                        options={OBJECTIVES}
                        value={draft.objective}
                        onChange={(v) => updateDraft({ objective: v })}
                        ariaLabel={t("objective")}
                      />
                    </Field>

                    <Field label={t("descriptionStyle")}>
                      <input
                        type="text"
                        className="input-field"
                        value={draft.description_style}
                        onChange={(e) =>
                          updateDraft({ description_style: e.target.value })
                        }
                        placeholder={t("tonePlaceholder")}
                      />
                    </Field>

                    <Field label="Extra brief (optional)">
                      <textarea
                        className="input-field"
                        rows={2}
                        value={draft.extra_brief}
                        onChange={(e) =>
                          updateDraft({ extra_brief: e.target.value })
                        }
                        placeholder={t("extraBriefPlaceholder")}
                      />
                    </Field>
                  </div>

                  <div>
                    <Field label={t("frequency")}>
                      <SegmentedControl
                        options={FREQUENCIES}
                        value={draft.schedule?.frequency || "daily"}
                        onChange={(v) => updateSchedule({ frequency: v })}
                        ariaLabel={t("frequency")}
                      />
                    </Field>

                    {(draft.schedule?.frequency === "weekdays" ||
                      draft.schedule?.frequency === "weekly") && (
                      <Field label="Days">
                        <div className="flex flex-wrap gap-1">
                          {WEEKDAY_LABELS.map((lbl, i) => {
                            const on = (draft.schedule?.weekdays || []).includes(i);
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => toggleWeekday(i)}
                                className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                                style={{
                                  background: on
                                    ? "var(--accent-primary)"
                                    : "var(--bg-tertiary)",
                                  color: on
                                    ? "white"
                                    : "var(--text-secondary)",
                                }}
                              >
                                {lbl}
                              </button>
                            );
                          })}
                        </div>
                      </Field>
                    )}

                    {draft.schedule?.frequency === "monthly" && (
                      <Field
                        label={t("daysOfMonth")}
                        hint="Comma-separated numbers (e.g. 1, 15, 28)"
                      >
                        <input
                          type="text"
                          className="input-field"
                          value={(draft.schedule?.month_days || []).join(", ")}
                          onChange={(e) => {
                            const nums = e.target.value
                              .split(/[,\s]+/)
                              .map((s) => parseInt(s, 10))
                              .filter(
                                (n) => Number.isInteger(n) && n >= 1 && n <= 31
                              );
                            updateSchedule({ month_days: nums });
                          }}
                          placeholder={t("rulePromptDaysPlaceholder")}
                        />
                      </Field>
                    )}

                    <Field label={t("publishTimes")}>
                      <div className="flex flex-col gap-2">
                        {(draft.schedule?.times || []).map((t, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <TimePicker
                              value={t}
                              onChange={(next) => updateTimeAt(idx, next)}
                            />
                            {(draft.schedule?.times || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeTime(idx)}
                                className="p-1.5 rounded-md transition-colors"
                                title={t("removeThisTime")}
                                style={{ color: "var(--status-error)" }}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addTime}
                          className="text-xs self-start inline-flex items-center gap-1 px-2 py-1 rounded"
                          style={{ color: "var(--accent-primary)" }}
                        >
                          <Plus size={12} /> Add a time
                        </button>
                      </div>
                    </Field>

                    <Field label={tCommon("language") === "Langue" ? "Fuseau horaire" : "Timezone"}>
                      <input
                        type="text"
                        className="input-field"
                        value={draft.schedule?.timezone || "UTC"}
                        onChange={(e) =>
                          updateSchedule({ timezone: e.target.value })
                        }
                        placeholder={t("tzPlaceholder")}
                      />
                    </Field>

                    <Field
                      label={t("telegramValidationLead")}
                      hint={t("leadHint")}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <div
                          className="inline-flex gap-1 p-1 rounded-lg"
                          style={{ background: "var(--bg-tertiary)" }}
                        >
                          {LEAD_PRESETS.map((m) => {
                            const on = draft.validation_lead_minutes === m;
                            return (
                              <button
                                key={m}
                                type="button"
                                onClick={() =>
                                  updateDraft({ validation_lead_minutes: m })
                                }
                                className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                                style={{
                                  background: on
                                    ? "var(--accent-primary)"
                                    : "transparent",
                                  color: on ? "white" : "var(--text-secondary)",
                                }}
                              >
                                {m < 60 ? `${m} min` : `${m / 60} h`}
                              </button>
                            );
                          })}
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          className="input-field"
                          style={{ width: 96 }}
                          value={draft.validation_lead_minutes || 30}
                          onChange={(e) =>
                            updateDraft({
                              validation_lead_minutes: parseInt(
                                e.target.value || 30,
                                10
                              ),
                            })
                          }
                        />
                        <span
                          className="text-[11px]"
                          style={{ color: "var(--text-muted)" }}
                        >
                          min
                        </span>
                      </div>
                    </Field>

                    <Field
                      label="Telegram chat (optional)"
                      hint="Empty = use the backend's default chat."
                    >
                      <input
                        type="text"
                        className="input-field"
                        value={draft.validation_chat_id || ""}
                        onChange={(e) =>
                          updateDraft({
                            validation_chat_id: e.target.value || null,
                          })
                        }
                        placeholder={t("telegramChatPlaceholder")}
                      />
                    </Field>

                    <Field label={t("publishTo")}>
                      <div className="flex flex-wrap gap-1.5">
                        {PLATFORMS.map((p) => {
                          const Icon = p.icon;
                          const on = !!draft.platforms?.[p.id];
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => togglePlatform(p.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                              style={{
                                background: on
                                  ? `${p.color}22`
                                  : "var(--bg-tertiary)",
                                color: on ? p.color : "var(--text-secondary)",
                                border: `1px solid ${
                                  on ? p.color : "transparent"
                                }`,
                              }}
                            >
                              <Icon size={12} />
                              {p.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                  </div>
                </div>

                <div
                  className="mt-4 pt-4 flex items-center justify-end gap-2"
                  style={{ borderTop: "1px solid var(--border-default)" }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="btn-secondary inline-flex items-center gap-2"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="btn-primary inline-flex items-center gap-2"
                  >
                    {saving ? (
                      <>
                        <Loader2 size={13} className="animate-spin" /> Saving…
                      </>
                    ) : (
                      <>
                        <Save size={13} /> Save
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
