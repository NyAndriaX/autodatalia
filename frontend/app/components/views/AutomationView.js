"use client";

import { btnPrimary, btnSecondary, inputField } from "../../lib/uiClasses";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import {
  Bot, Plus, Trash2, Save, Loader2, Power, PowerOff, Clock,
  ListChecks, X, Settings2, Sparkles, Zap, CalendarDays, Radio,
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

/* ─── données statiques (traduites) ─────────────────────────────────────*/
const CONTENT_TYPES = [
  { id:"photo",    label:"Photo",    emoji:"🖼️" },
  { id:"video",    label:"Vidéo",    emoji:"🎬" },
  { id:"carousel", label:"Carrousel",emoji:"📱" },
  { id:"template", label:"Modèle",   emoji:"📄" },
  { id:"text",     label:"Texte",    emoji:"✍️" },
];

const OBJECTIVES = [
  { id:"informative",  label:"Informatif"   },
  { id:"promotional",  label:"Promotionnel" },
  { id:"engagement",   label:"Engagement"   },
  { id:"acquisition",  label:"Acquisition"  },
];

const FREQUENCIES = [
  { id:"daily",    label:"Quotidien"        },
  { id:"weekdays", label:"Jours spécifiques"},
  { id:"weekly",   label:"Hebdomadaire"     },
  { id:"monthly",  label:"Mensuel"          },
  { id:"custom",   label:"Personnalisé"     },
];

const WEEKDAY_LABELS = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];
const LEAD_PRESETS   = [5, 30, 60];

function resuméPlanning(rule) {
  const s     = rule.schedule || {};
  const times = (s.times || []).join(", ") || "—";
  switch (s.frequency) {
    case "daily":    return `Quotidien à ${times}`;
    case "weekdays": return `${(s.weekdays||[]).map((d) => WEEKDAY_LABELS[d]).join(", ")||"(aucun jour)"} à ${times}`;
    case "weekly":   return `Chaque ${WEEKDAY_LABELS[(s.weekdays||[])[0]??0]} à ${times}`;
    case "monthly":  return `Jour(s) ${(s.month_days||[]).join(", ")||"?"} à ${times}`;
    case "custom":   return `Personnalisé · ${times}`;
    default:         return "—";
  }
}

/* ─── Chips ──────────────────────────────────────────────────────────────*/
function Chips({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button key={opt.id} type="button" onClick={() => onChange(opt.id)}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150"
            style={{
              background: active ? "var(--accent-primary)" : "var(--bg-tertiary)",
              color:      active ? "#fff"                  : "var(--text-secondary)",
              border:     `1px solid ${active ? "transparent" : "var(--border-default)"}`,
              cursor:"pointer",
            }}>
            {opt.emoji && <span className="mr-1">{opt.emoji}</span>}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Champ de formulaire ────────────────────────────────────────────────*/
function Champ({ label, hint, children }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
        {label}
      </p>
      {children}
      {hint && <p className="mt-1 text-[11px]" style={{ color:"var(--text-muted)" }}>{hint}</p>}
    </div>
  );
}

/* ─── Carte de règle ─────────────────────────────────────────────────────*/
function CarteRegle({ rule, active, onClick }) {
  const nbMedia = rule.num_media?.mode === "range"
    ? `${rule.num_media.min}–${rule.num_media.max} médias`
    : `${rule.num_media?.count ?? 1} média${(rule.num_media?.count ?? 1) > 1 ? "s" : ""}`;
  return (
    <button type="button" onClick={onClick}
      className="w-full rounded-2xl p-4 text-left transition-all duration-150"
      style={{
        background: active ? "rgba(29,63,190,.08)"    : "var(--bg-tertiary)",
        border:     `1.5px solid ${active ? "var(--accent-primary)" : "var(--border-default)"}`,
        cursor:"pointer",
      }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
            style={{
              background: rule.active ? "rgba(34,197,94,.15)"   : "rgba(100,116,139,.12)",
              color:      rule.active ? "var(--status-approved)" : "var(--text-muted)",
            }}>
            <Radio size={13} />
          </span>
          <span className="truncate text-sm font-bold" style={{ color:"var(--text-primary)" }}>
            {rule.name}
          </span>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
          style={{
            background: rule.active ? "rgba(34,197,94,.15)"   : "rgba(100,116,139,.12)",
            color:      rule.active ? "var(--status-approved)" : "var(--text-muted)",
          }}>
          {rule.active ? "Actif" : "Inactif"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]" style={{ color:"var(--text-muted)" }}>
        <Clock size={10} />
        <span className="truncate">{resuméPlanning(rule)}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px]" style={{ color:"var(--text-muted)" }}>
        <ListChecks size={10} />
        {rule.content_type} · {nbMedia}
      </div>
    </button>
  );
}

/* ─── État vide ──────────────────────────────────────────────────────────*/
function EtatVide() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-20 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background:"rgba(29,63,190,.08)", border:"1px solid rgba(29,63,190,.2)" }}>
        <Bot size={32} style={{ color:"var(--accent-primary)" }} />
      </div>
      <p className="text-base font-bold" style={{ color:"var(--text-primary)" }}>
        Sélectionnez ou créez une règle
      </p>
      <p className="mt-2 max-w-xs text-sm" style={{ color:"var(--text-muted)" }}>
        Les règles définissent quoi générer, quand publier, et qui valide via Telegram.
      </p>
    </div>
  );
}

/* ─── Composant principal ────────────────────────────────────────────────*/
export default function AutomationView() {
  const dispatch = useDispatch();
  const [rules,      setRules]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [draft,      setDraft]      = useState(DEFAULT_AUTOMATION_RULE);
  const [saving,     setSaving]     = useState(false);
  const [onglet,     setOnglet]     = useState("contenu");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRules(await listAutomationRules());
    } catch (err) {
      dispatch(addNotification({ message:`Impossible de charger les règles : ${err.message}`, type:"error" }));
    } finally {
      setLoading(false);
    }
  }, [dispatch]);

  useEffect(() => { refresh(); }, [refresh]);

  const selected = useMemo(
    () => selectedId && selectedId !== "new" ? rules.find((r) => r.id === selectedId) || null : null,
    [selectedId, rules]
  );

  useEffect(() => {
    if (selectedId === "new") setDraft({ ...DEFAULT_AUTOMATION_RULE, name:"Nouvelle règle" });
    else if (selected)        setDraft({ ...DEFAULT_AUTOMATION_RULE, ...selected });
  }, [selectedId, selected]);

  const upd         = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const updPlanning = (patch) => setDraft((d) => ({ ...d, schedule:  { ...d.schedule, ...patch } }));
  const updMédias   = (patch) => setDraft((d) => ({ ...d, num_media: { ...d.num_media, ...patch } }));

  const togglePlateforme = (id) =>
    setDraft((d) => ({ ...d, platforms: { ...d.platforms, [id]: !d.platforms?.[id] } }));

  const toggleJour = (day) => {
    const cur  = draft.schedule?.weekdays || [];
    const next = cur.includes(day) ? cur.filter((x) => x !== day) : [...cur, day].sort((a,b)=>a-b);
    updPlanning({ weekdays: next });
  };

  const majHeure    = (idx, val) => {
    const next = [...(draft.schedule?.times || [])];
    next[idx] = val;
    updPlanning({ times: next });
  };
  const ajouterHeure  = () => updPlanning({ times: [...(draft.schedule?.times || []), "12:00"] });
  const supprimerHeure = (idx) => updPlanning({ times: (draft.schedule?.times || []).filter((_,i) => i!==idx) });

  const handleSave = async () => {
    if (!draft.name?.trim()) {
      dispatch(addNotification({ message:"Le nom de la règle est obligatoire.", type:"error" }));
      return;
    }
    setSaving(true);
    try {
      if (selectedId === "new") {
        const created = await createAutomationRule(draft);
        await refresh();
        dispatch(addNotification({ message:`Règle créée : ${created.name}`, type:"success" }));
      } else if (selected) {
        await updateAutomationRule(selected.id, draft);
        await refresh();
        dispatch(addNotification({ message:"Règle mise à jour.", type:"success" }));
      }
      setSelectedId(null);
    } catch (err) {
      dispatch(addNotification({ message:`Échec de l'enregistrement : ${err.message}`, type:"error" }));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActif = async (rule) => {
    try {
      await updateAutomationRule(rule.id, { ...rule, active: !rule.active });
      refresh();
    } catch (err) {
      dispatch(addNotification({ message:`Erreur : ${err.message}`, type:"error" }));
    }
  };

  const handleSupprimer = async (rule) => {
    if (!window.confirm(`Supprimer la règle "${rule.name}" ?`)) return;
    try {
      await deleteAutomationRule(rule.id);
      if (selectedId === rule.id) setSelectedId(null);
      refresh();
      dispatch(addNotification({ message:"Règle supprimée.", type:"success" }));
    } catch (err) {
      dispatch(addNotification({ message:`Erreur : ${err.message}`, type:"error" }));
    }
  };

  const ONGLETS = [
    { id:"contenu",     label:"Contenu",     icon:Sparkles     },
    { id:"planification",label:"Planification",icon:CalendarDays },
    { id:"telegram",    label:"Telegram",    icon:Zap          },
  ];

  return (
    <div className="h-full overflow-y-auto" style={{ background:"var(--bg-primary)" }}>
      <div style={{ padding:"24px" }}>

        {/* ═ EN-TÊTE ═════════════════════════════════════════════════════ */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl"
              style={{ background:"var(--accent-gradient)", boxShadow:"0 4px 14px rgba(29,63,190,.35)" }}>
              <Bot size={22} color="white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold leading-tight" style={{ color:"var(--text-primary)" }}>
                Automatisation
              </h1>
              <p className="text-xs" style={{ color:"var(--text-muted)" }}>
                Génération · Validation Telegram · Publication planifiée
              </p>
            </div>
          </div>
          <button type="button" onClick={() => { setSelectedId("new"); setOnglet("contenu"); }}
            className={`${btnPrimary} inline-flex items-center gap-2`}>
            <Plus size={15} /> Nouvelle règle
          </button>
        </div>

        {/* ═ CORPS ════════════════════════════════════════════════════════ */}
        <div className="flex gap-4" style={{ minHeight: 560 }}>

          {/* ── Liste des règles ─────────────────────────────────────── */}
          <aside style={{ width: 300, flexShrink: 0 }}>
            <div className="rounded-2xl p-4 h-full"
              style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-widest" style={{ color:"var(--text-muted)" }}>
                {loading ? "Chargement…" : `${rules.length} règle${rules.length !== 1 ? "s" : ""}`}
              </p>
              {loading && (
                <div className="flex items-center gap-2 text-xs" style={{ color:"var(--text-muted)" }}>
                  <Loader2 size={12} className="animate-spin" /> Chargement des règles…
                </div>
              )}
              {!loading && rules.length === 0 && (
                <div className="py-8 text-center text-sm" style={{ color:"var(--text-muted)" }}>
                  Aucune règle. Cliquez sur<br />"Nouvelle règle" pour commencer.
                </div>
              )}
              <div className="flex flex-col gap-2">
                {rules.map((r) => (
                  <CarteRegle key={r.id} rule={r} active={selectedId === r.id}
                    onClick={() => { setSelectedId(r.id); setOnglet("contenu"); }} />
                ))}
              </div>
            </div>
          </aside>

          {/* ── Éditeur ─────────────────────────────────────────────── */}
          <section className="flex min-w-0 flex-1 flex-col rounded-2xl overflow-hidden"
            style={{ background:"var(--bg-card)", border:"1px solid var(--border-default)" }}>
            {!selectedId ? (
              <EtatVide />
            ) : (
              <>
                {/* en-tête éditeur */}
                <div className="flex items-center justify-between px-6 py-4"
                  style={{ borderBottom:"1px solid var(--border-default)" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Settings2 size={18} style={{ color:"var(--accent-primary)", flexShrink:0 }} />
                    <h2 className="truncate text-base font-bold" style={{ color:"var(--text-primary)" }}>
                      {selectedId === "new" ? "Nouvelle règle" : draft.name}
                    </h2>
                    {selected && (
                      <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                        style={{
                          background: selected.active ? "rgba(34,197,94,.15)" : "rgba(100,116,139,.12)",
                          color:      selected.active ? "var(--status-approved)" : "var(--text-muted)",
                        }}>
                        {selected.active ? "Actif" : "Inactif"}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selected && (
                      <>
                        <button type="button" onClick={() => handleToggleActif(selected)}
                          className={`${btnSecondary} text-xs inline-flex items-center gap-1.5`}
                          style={{ padding:"6px 12px" }}>
                          {selected.active
                            ? <><PowerOff size={12}/> Désactiver</>
                            : <><Power    size={12}/> Activer</>}
                        </button>
                        <button type="button" onClick={() => handleSupprimer(selected)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                          style={{ background:"rgba(239,68,68,.1)", color:"var(--status-error)", border:"none", cursor:"pointer" }}>
                          <Trash2 size={12}/> Supprimer
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => setSelectedId(null)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background:"var(--bg-tertiary)", border:"1px solid var(--border-default)", cursor:"pointer", color:"var(--text-secondary)" }}>
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {/* onglets */}
                <div className="flex gap-0 px-6 pt-4"
                  style={{ borderBottom:"1px solid var(--border-default)" }}>
                  {ONGLETS.map(({ id, label, icon: Icon }) => (
                    <button key={id} type="button" onClick={() => setOnglet(id)}
                      className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all"
                      style={{
                        color:      onglet === id ? "var(--accent-primary)" : "var(--text-muted)",
                        borderBottom: `2px solid ${onglet === id ? "var(--accent-primary)" : "transparent"}`,
                        background:"none", border:"none",
                        borderBottomWidth:2, borderBottomStyle:"solid",
                        borderBottomColor: onglet === id ? "var(--accent-primary)" : "transparent",
                        cursor:"pointer", marginBottom:-1,
                      }}>
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>

                {/* contenu de l'onglet */}
                <div className="flex-1 overflow-y-auto px-6 py-5">

                  {/* ── CONTENU ─────────────────────────────────────── */}
                  {onglet === "contenu" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                      <div>
                        <Champ label="Nom de la règle">
                          <input type="text" className={inputField} value={draft.name}
                            onChange={(e) => upd({ name: e.target.value })}
                            placeholder="ex. Carrousel du matin" />
                        </Champ>
                        <Champ label="Type de contenu">
                          <Chips options={CONTENT_TYPES} value={draft.content_type}
                            onChange={(v) => upd({ content_type: v })} />
                        </Champ>
                        <Champ label="Nombre de médias"
                          hint="Fixe = toujours N · Plage = l'IA choisit dans [min, max]">
                          <div className="mb-2">
                            <Chips
                              options={[{ id:"fixed", label:"Fixe" }, { id:"range", label:"Plage" }]}
                              value={draft.num_media?.mode || "fixed"}
                              onChange={(v) => updMédias({ mode: v })} />
                          </div>
                          {draft.num_media?.mode === "fixed" ? (
                            <input type="number" min={1} max={10} className={inputField}
                              style={{ width:96 }} value={draft.num_media?.count ?? 1}
                              onChange={(e) => updMédias({ count: parseInt(e.target.value||1,10) })} />
                          ) : (
                            <div className="flex items-center gap-2">
                              <input type="number" min={1} max={10} className={inputField} style={{ width:76 }}
                                value={draft.num_media?.min ?? 2}
                                onChange={(e) => updMédias({ min: parseInt(e.target.value||1,10) })} />
                              <span className="text-xs" style={{ color:"var(--text-muted)" }}>à</span>
                              <input type="number" min={1} max={10} className={inputField} style={{ width:76 }}
                                value={draft.num_media?.max ?? 4}
                                onChange={(e) => updMédias({ max: parseInt(e.target.value||1,10) })} />
                            </div>
                          )}
                        </Champ>
                        <Champ label="Domaine / sujet">
                          <input type="text" className={inputField} value={draft.domain}
                            onChange={(e) => upd({ domain: e.target.value })}
                            placeholder="immobilier, marketing, santé…" />
                        </Champ>
                        <Champ label="Audience cible">
                          <input type="text" className={inputField} value={draft.target_audience}
                            onChange={(e) => upd({ target_audience: e.target.value })}
                            placeholder="PDG, start-ups, investisseurs…" />
                        </Champ>
                      </div>
                      <div>
                        <Champ label="Ton de communication">
                          <Chips
                            options={[{ id:"", label:"Auto" }, ...TONES.map((t) => ({ id:t.id, label:t.label }))]}
                            value={draft.tone || ""}
                            onChange={(v) => upd({ tone: v })} />
                        </Champ>
                        <Champ label="Objectif">
                          <Chips options={OBJECTIVES} value={draft.objective}
                            onChange={(v) => upd({ objective: v })} />
                        </Champ>
                        <Champ label="Style de description">
                          <input type="text" className={inputField} value={draft.description_style}
                            onChange={(e) => upd({ description_style: e.target.value })}
                            placeholder="concis, factuel, sans emojis" />
                        </Champ>
                        <Champ label="Brief supplémentaire (optionnel)">
                          <textarea className={inputField} rows={3} value={draft.extra_brief}
                            onChange={(e) => upd({ extra_brief: e.target.value })}
                            placeholder="Instruction libre ajoutée en début de prompt IA." />
                        </Champ>
                        <Champ label="Plateformes">
                          <div className="flex flex-wrap gap-1.5">
                            {PLATFORMS.map((p) => {
                              const Icon = p.icon;
                              const on   = !!draft.platforms?.[p.id];
                              return (
                                <button key={p.id} type="button" onClick={() => togglePlateforme(p.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                                  style={{
                                    background: on ? `${p.color}22` : "var(--bg-tertiary)",
                                    color:      on ? p.color         : "var(--text-secondary)",
                                    border:     `1px solid ${on ? p.color : "var(--border-default)"}`,
                                    cursor:"pointer",
                                  }}>
                                  <Icon size={12} /> {p.label}
                                </button>
                              );
                            })}
                          </div>
                        </Champ>
                      </div>
                    </div>
                  )}

                  {/* ── PLANIFICATION ─────────────────────────────── */}
                  {onglet === "planification" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
                      <div>
                        <Champ label="Fréquence">
                          <Chips options={FREQUENCIES} value={draft.schedule?.frequency || "daily"}
                            onChange={(v) => updPlanning({ frequency: v })} />
                        </Champ>

                        {(draft.schedule?.frequency === "weekdays" || draft.schedule?.frequency === "weekly") && (
                          <Champ label="Jours de la semaine">
                            <div className="flex flex-wrap gap-1.5">
                              {WEEKDAY_LABELS.map((lbl, i) => {
                                const on = (draft.schedule?.weekdays || []).includes(i);
                                return (
                                  <button key={i} type="button" onClick={() => toggleJour(i)}
                                    className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                                    style={{
                                      background: on ? "var(--accent-primary)" : "var(--bg-tertiary)",
                                      color:      on ? "#fff"                  : "var(--text-secondary)",
                                      border:     `1px solid ${on ? "transparent" : "var(--border-default)"}`,
                                      cursor:"pointer",
                                    }}>
                                    {lbl}
                                  </button>
                                );
                              })}
                            </div>
                          </Champ>
                        )}

                        {draft.schedule?.frequency === "monthly" && (
                          <Champ label="Jours du mois" hint="Séparés par des virgules (ex. 1, 15, 28)">
                            <input type="text" className={inputField}
                              value={(draft.schedule?.month_days || []).join(", ")}
                              onChange={(e) => {
                                const nums = e.target.value.split(/[,\s]+/)
                                  .map((s) => parseInt(s,10))
                                  .filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
                                updPlanning({ month_days: nums });
                              }}
                              placeholder="1, 15, 28" />
                          </Champ>
                        )}

                        <Champ label="Heures de publication">
                          <div className="flex flex-col gap-2">
                            {(draft.schedule?.times || []).map((t, idx) => (
                              <div key={idx} className="flex items-center gap-2">
                                <TimePicker value={t} onChange={(next) => majHeure(idx, next)} />
                                {(draft.schedule?.times || []).length > 1 && (
                                  <button type="button" onClick={() => supprimerHeure(idx)}
                                    className="rounded-lg p-1.5"
                                    style={{ color:"var(--status-error)", background:"rgba(239,68,68,.08)", border:"none", cursor:"pointer" }}>
                                    <X size={13} />
                                  </button>
                                )}
                              </div>
                            ))}
                            <button type="button" onClick={ajouterHeure}
                              className="self-start text-xs font-semibold inline-flex items-center gap-1"
                              style={{ color:"var(--accent-primary)", background:"none", border:"none", cursor:"pointer" }}>
                              <Plus size={12} /> Ajouter une heure
                            </button>
                          </div>
                        </Champ>
                      </div>
                      <div>
                        <Champ label="Fuseau horaire">
                          <input type="text" className={inputField}
                            value={draft.schedule?.timezone || "UTC"}
                            onChange={(e) => updPlanning({ timezone: e.target.value })}
                            placeholder="Europe/Paris, America/Toronto" />
                        </Champ>
                      </div>
                    </div>
                  )}

                  {/* ── TELEGRAM ──────────────────────────────────── */}
                  {onglet === "telegram" && (
                    <div className="max-w-md">
                      <div className="mb-5 rounded-2xl p-4"
                        style={{ background:"rgba(29,63,190,.06)", border:"1px solid rgba(29,63,190,.2)" }}>
                        <p className="text-xs font-semibold" style={{ color:"var(--accent-primary)" }}>
                          Comment ça fonctionne
                        </p>
                        <p className="mt-1 text-xs leading-relaxed" style={{ color:"var(--text-muted)" }}>
                          Avant chaque publication, le bot envoie un aperçu au chat du validateur.
                          Celui-ci peut approuver, modifier ou rejeter le post. Définissez le délai
                          d'avance pour laisser suffisamment de temps à l'équipe de répondre.
                        </p>
                      </div>

                      <Champ label="Délai de validation" hint="Combien de temps avant la publication le bot demande l'approbation.">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {LEAD_PRESETS.map((m) => {
                            const on = draft.validation_lead_minutes === m;
                            return (
                              <button key={m} type="button"
                                onClick={() => upd({ validation_lead_minutes: m })}
                                className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
                                style={{
                                  background: on ? "var(--accent-primary)" : "var(--bg-tertiary)",
                                  color:      on ? "#fff"                  : "var(--text-secondary)",
                                  border:     `1px solid ${on ? "transparent" : "var(--border-default)"}`,
                                  cursor:"pointer",
                                }}>
                                {m < 60 ? `${m} min` : `${m/60} h`}
                              </button>
                            );
                          })}
                          <input type="number" min={1} max={1440} className={inputField} style={{ width:88 }}
                            value={draft.validation_lead_minutes || 30}
                            onChange={(e) => upd({ validation_lead_minutes: parseInt(e.target.value||30,10) })} />
                          <span className="text-xs" style={{ color:"var(--text-muted)" }}>min</span>
                        </div>
                      </Champ>

                      <Champ label="ID de chat Telegram (optionnel)"
                        hint="Vide = utiliser le chat par défaut du serveur.">
                        <input type="text" className={inputField}
                          value={draft.validation_chat_id || ""}
                          onChange={(e) => upd({ validation_chat_id: e.target.value || null })}
                          placeholder="ID numérique" />
                      </Champ>
                    </div>
                  )}
                </div>

                {/* pied de page */}
                <div className="flex items-center justify-between gap-3 px-6 py-4"
                  style={{ borderTop:"1px solid var(--border-default)" }}>
                  <div className="flex gap-1">
                    {ONGLETS.map(({ id }) => (
                      <span key={id} className="h-1.5 w-1.5 rounded-full transition-all"
                        style={{ background: onglet === id ? "var(--accent-primary)" : "var(--border-default)" }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setSelectedId(null)}
                      className={`${btnSecondary} inline-flex items-center gap-2`}>
                      Annuler
                    </button>
                    <button type="button" onClick={handleSave} disabled={saving}
                      className={`${btnPrimary} inline-flex items-center gap-2`}>
                      {saving
                        ? <><Loader2 size={13} className="animate-spin"/> Enregistrement…</>
                        : <><Save size={13}/> Enregistrer</>}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
