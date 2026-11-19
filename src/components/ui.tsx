"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { MIN_PROFESSORS, PERIODS, TEXTS, VALIDATION_ROWS, onSource } from "@/lib/data";
import { GUIDANCE, bandTrackRecord, formatDoubleRate, formatPeriod, formatProbability, habitualRate, number, plural, share } from "@/lib/domain";
import { CASE_LABELS, STATES, type AdoptionState, type Condition, type PeriodId, type ProbabilityBand, type TeacherToolRecord, type Tool, type ToolId } from "@/lib/types";

export { number, plural };

const paths: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  tools: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 10h16M10 10v10M8 7h.01M11 7h.01"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/></>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/></>,
  trend: <><path d="M3 18 9 12l4 3 8-10M15 5h6v6"/></>,
  arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  arrowUp: <><path d="M6 18 18 6M6 6h12v12"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  plus: <path d="M12 5v14M5 12h14"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  upload: <><path d="M12 15V3M7 8l5-5 5 5M4 16v5h16v-5"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
  building: <><path d="m3 9 9-6 9 6M3 21h18M5 9v12m5-12v12m4-12v12m5-12v12M2 9h20"/></>,
  leaf: <><path d="M20 3C9 2 2 7 5 15c8 5 15-1 15-12ZM4 21 16 8"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  book: <><path d="M12 5v16M3 3c4 0 7 0 9 2 2-2 5-2 9-2v16c-4 0-7 0-9 2-2-2-5-2-9-2V3Z"/></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/></>,
  person: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
};

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.arrow}</svg>;
}
export const pct = (n: number, total: number) => total ? `${Math.round(n / total * 100)}\u00a0%` : "—";
// Texts that name the open file's minimum, first semester or forecast target, recomputed for each file.
export let fewNote = "";
/** First semester with data: «nunca» on screen always means «desde» this one. */
export let SINCE = "";
/** The forecast target is the held-out semester. */
export let TARGET: PeriodId | null = null;
export let nextTerm = "";
/** Short phrase that goes next to each state name everywhere. */
export let STATE_SHORT = {} as Record<AdoptionState, string>;
/** Plain definition of each state. */
export let STATE_PLAIN = {} as Record<AdoptionState, string>;
onSource(() => {
  fewNote = `Con menos de ${MIN_PROFESSORS} profesores no se muestran porcentaje ni barra: pocos profesores.`;
  SINCE = formatPeriod(PERIODS[0]);
  TARGET = TEXTS.cleanTest;
  nextTerm = TARGET ? `en ${formatPeriod(TARGET)}` : "el semestre siguiente";
  STATE_SHORT = {
    Adopta: `la usa por primera vez desde ${SINCE}`,
    Usa: "la usa semestre tras semestre",
    Apropia: `la usa seguido y con más ${TEXTS.unit} que la mayoría (más que 3 de cada 4 semestres de uso)`,
    "No expuesto": `no la ha usado con estudiantes desde ${SINCE}`,
    Abandona: "la dejó; puede retomarla",
    "Sin información": "probó y no siguió, la retomó o falta información",
  };
  STATE_PLAIN = {
    Adopta: `Es el primer semestre en que sus estudiantes la usan desde ${SINCE}; aún no se sabe si seguirá.`,
    Usa: "Sus estudiantes la usan 2 o más semestres seguidos.",
    Apropia: `La usa semestre tras semestre y pone más ${TEXTS.unit} que 3 de cada 4 semestres de uso de todos los profesores.`,
    "No expuesto": `Ninguno de sus estudiantes la ha usado desde ${SINCE}. Puede haberla tenido configurada.`,
    Abandona: "La usó 2 o más semestres seguidos y después dejó de usarla. Puede retomarla.",
    "Sin información": "No tiene uno de los 5 estados.",
  };
});
/** «Taller sugerido» carries one provisional mark: the name's own, or this one. */
export const workshopNote = (tool: Tool) => tool.workshop.includes("provisional") ? "" : "Sugerencia inicial, pendiente de aprobación de Conecta-TE.";
/** «30 % o más», «de 15 % a menos de 30 %»…; the synthetic test data has fixed cuts in its labels. */
export function bandRange(toolId: ToolId, band: ProbabilityBand): string {
  const habitual = habitualRate(toolId);
  if (!TEXTS.relativeBands || habitual === null) return TEXTS.bands[band];
  return { Baja: `menos de ${formatProbability(habitual)}`, Media: `de ${formatProbability(habitual)} a menos de ${formatDoubleRate(toolId)}`, Alta: `${formatDoubleRate(toolId)} o más` }[band];
}
// A tool without a habitual rate has no relative cut to show next to the band name.
export const bandText = (toolId: ToolId, band: ProbabilityBand) => TEXTS.relativeBands && habitualRate(toolId) !== null ? `${TEXTS.bands[band]} (${bandRange(toolId, band)})` : TEXTS.bands[band];
/** What happened in the review to the cases of a band, so a probability is not read as a certainty; empty without a review. */
export function trackSentence(toolId: ToolId, band: ProbabilityBand): string {
  const { cases, started } = bandTrackRecord(toolId, band);
  if (!cases) return "";
  const periods = [...new Set(VALIDATION_ROWS.filter(row => row.toolId === toolId).map(row => formatPeriod(row.period)))].sort().join(" y ");
  const per10 = Math.round(started / cases * 10);
  return `En la revisión de ${periods}, de ${plural(cases, "caso", "casos")} con probabilidad «${TEXTS.bands[band].toLocaleLowerCase("es")}», ${number(started)} la configuraron: ${per10 < 1 ? "menos de 1" : `unos ${number(per10)}`} de cada 10.`;
}
/** When «más del doble» and «entre lo habitual y el doble» hit alike in the review, the cut orders but does not split two different groups. */
export function bandsAlike(toolId: ToolId): string {
  const [high, middle] = (["Alta", "Media"] as const).map(band => bandTrackRecord(toolId, band));
  if (!high.cases || !middle.cases) return "";
  const [a, b] = [high, middle].map(row => Math.round(row.started / row.cases * 10));
  if (a !== b) return "";
  return `Ojo con el corte: en la revisión, «${TEXTS.bands.Alta.toLocaleLowerCase("es")}» y «${TEXTS.bands.Media.toLocaleLowerCase("es")}» acertaron parecido (unos ${number(a)} de cada 10 la configuraron en los dos). El corte sirve para ordenar, no separa dos grupos muy distintos.`;
}
/** Plain meaning of the words of the technical model text, which comes from the file as written. */
export const MODEL_TERMS = "Palabras del texto técnico: «Markov con variables» es un método que estima a qué grupo pasará cada profesor la próxima vez que dicte, según su grupo actual y otros datos (su facultad, sus estudiantes, su historia); «modelo directo de herramientas» pasa de ese grupo probable a la probabilidad de configurar cada herramienta; «transiciones» son los pasos de un semestre al siguiente; «salto 1» quiere decir el semestre inmediatamente siguiente; «notebook 05» es el cuaderno de análisis del equipo donde se eligió este pronóstico.";
/** Framework definitions, kept for the guide. */
export const stateDescriptions: Record<AdoptionState, string> = {
  "No expuesto": "Sin uso efectivo en la historia observada.",
  Adopta: "Primer uso efectivo; la continuidad está por confirmar.",
  Usa: "La herramienta se mantiene en periodos consecutivos.",
  Apropia: "Uso sostenido con intensidad por encima del corte de referencia.",
  Abandona: "Interrumpió una herramienta que antes usaba sostenidamente.",
  "Sin información": "La evidencia o la regla no permiten asignar un estado.",
};
export const conditionDescriptions: Record<Condition, string> = {
  regla: "La usó con estudiantes pero nunca 2 semestres seguidos y hoy no la usa, o la retomó después de dejarla: el dato existe, pero el marco todavía no tiene una regla para estos casos.",
  dato: "Falta el dato de uso con estudiantes de ese semestre, o la historia no se puede comparar.",
  configuracion: "De esta herramienta solo se sabe si está configurada, no si sus estudiantes la usan.",
};
export function StateBadge({ state, label = state }: { state: AdoptionState; label?: string }) {
  return <span className="state-badge" data-state={state}><span className="state-dot" data-state={state}/>{label}</span>;
}
/** Neutral icon: characters taken from the code read as a rank or a score. */
export function PersonIcon() {
  return <span className="avatar" aria-hidden="true"><Icon name="person" size={16}/></span>;
}
export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="panel-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 className="section-title">{title}</h2>{description && <p className="section-description">{description}</p>}</div>{action}</div>;
}
export function Metric({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: ReactNode; icon?: string }) {
  return <div className="metric"><div className="metric-label">{label}{icon && <span className="metric-icon"><Icon name={icon}/></span>}</div><div className="metric-value">{value}</div>{detail && <div className="metric-detail">{detail}</div>}</div>;
}
// Real forecasts exist only at their origin period; elsewhere an empty list would read as "nobody".
export const offOrigin = (period: PeriodId) => TEXTS.forecastOrigin !== null && period !== TEXTS.forecastOrigin;
export function OffOrigin({ period, onGo, extra }: { period: PeriodId; onGo: (period: PeriodId) => void; extra?: ReactNode }) {
  const origin = TEXTS.forecastOrigin;
  if (!origin || period === origin) return null;
  return <EmptyState title={`Solo hay pronóstico con datos de ${formatPeriod(origin)}`} description={`El pronóstico estima, con datos de ${formatPeriod(origin)}, quién configurará cada herramienta la próxima vez que dicte${TARGET ? ` (${formatPeriod(TARGET)})` : ""}. Para ${formatPeriod(period)} no hay pronóstico.`} action={<div className="heading-links"><button className="button button-secondary" onClick={() => onGo(origin)}>Ver {formatPeriod(origin)}</button>{extra}</div>}/>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name="search" size={25}/></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function StateBars({ records, onSelect, compact = false }: { records: TeacherToolRecord[]; onSelect?: (state: AdoptionState) => void; compact?: boolean }) {
  const evaluated = records.filter(r => r.state !== "Sin información").length;
  const count = (states: readonly AdoptionState[]) => records.filter(r => states.includes(r.state)).length;
  // Each case without a framework state keeps its own count, outside the percentages.
  const cases = (["regla", "dato"] as Condition[]).map(c => [c, records.filter(r => r.condition === c).length] as const);
  const subtotal = (title: string, states: readonly AdoptionState[]) => { const n = count(states); const part = share(n, evaluated); return <p className="state-group">{title} · {number(n)} de los {number(evaluated)} con uno de los 5 estados{part.ratio !== null ? ` (${part.text})` : ""}</p>; };
  return <div className={`bar-list ${compact ? "is-compact" : "state-bars"}`}>
    {STATES.map(state => {
      const n = count([state]);
      const part = share(n, evaluated);
      const firstTime = state === "Adopta" || state === "No expuesto" ? records.filter(r => r.state === state && r.taughtSemesters === 1).length : 0;
      const content = <><span className="bar-label"><span className="state-dot" data-state={state}/><span>{state}{!compact && <small>{STATE_SHORT[state]}</small>}</span></span><span className="bar-track"><span className="bar-fill" data-state={state} style={{ "--bar-width": `${(part.ratio ?? 0) * 100}%` } as CSSProperties}/></span><span className="bar-value">{number(n)}<span>{part.ratio === null && evaluated ? `de ${number(evaluated)}` : part.text}</span></span>{!compact && <span className="bar-detail">Qué conversar: {GUIDANCE[state]}{firstTime > 0 ? ` · ${plural(firstTime, "dicta", "dictan")} por primera vez en los datos (desde ${SINCE})` : ""}</span>}{compact && firstTime > 0 && <span className="bar-detail">{plural(firstTime, "dicta", "dictan")} por primera vez en los datos (desde {SINCE})</span>}</>;
      const row = onSelect ? <button className="bar-row" key={state} data-state={state} onClick={() => onSelect(state)} aria-label={`${state}: ${number(n)} de ${number(evaluated)} profesores${part.ratio !== null ? ` (${part.text})` : ""}. Ver lista`}>{content}</button> : <div className="bar-row" key={state} data-state={state}>{content}</div>;
      return !compact && state === "Adopta" ? <div key={state} className="state-group-wrap">{subtotal("Ya la usan con estudiantes", ["Adopta", "Usa", "Apropia"])}{row}</div> : !compact && state === "No expuesto" ? <div key={state} className="state-group-wrap">{subtotal("No la usan ahora", ["No expuesto", "Abandona"])}{row}</div> : row;
    })}
    <p className="bar-detail">{compact
      ? `${plural(evaluated, "profesor clasificado", "profesores clasificados")} (con uno de los 5 estados)${cases.map(([c, n]) => n ? ` · ${CASE_LABELS[c]}: ${number(n)}` : "").join("")}`
      : `Los porcentajes se calculan sobre ${plural(evaluated, "profesor", "profesores")} con uno de los 5 estados${records[0] ? ` en ${records[0].tool.name}` : ""}.`}{evaluated > 0 && evaluated < MIN_PROFESSORS ? ` ${fewNote}` : ""}</p>
    {!compact && <details className="bar-detail count-detail"><summary>Cómo se cuentan quienes no tienen estado</summary>{`Sin estado: ${number(cases[0][1])} «${CASE_LABELS.regla}» (la usaron sin llegar a 2 semestres seguidos, o la retomaron después de dejarla; algunos la usan hoy) y ${number(cases[1][1])} «${CASE_LABELS.dato}». ${number(evaluated)} + ${number(cases[0][1])} + ${number(cases[1][1])} = ${number(records.length)}.`}</details>}
  </div>;
}
/** `habitual` draws a thin mark at the tool's habitual rate. */
export function Probability({ value, missing = "Sin estimación (no es 0 %)", habitual = null }: { value: number | null; missing?: string; habitual?: number | null }) {
  if (value === null) return <span className="muted small">{missing}</span>;
  return <div className="probability-cell"><span>{formatProbability(value)}</span><span className="probability-track">{habitual !== null && <i style={{ left: `${habitual * 100}%` }}/>}<span style={{width:`${value * 100}%`}}/></span></div>;
}
export function Dialog({ title, eyebrow, children, footer, onClose, wide = false }: { title: string; eyebrow?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    const focused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    if (el && !el.open) el.showModal();
    document.body.style.overflow = "hidden";
    return () => { el?.close(); document.body.style.overflow = previousOverflow; focused?.focus(); };
  }, []);
  return <dialog ref={ref} className={`dialog-panel ${wide ? "is-wide" : ""}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <div className="dialog-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2></div><button className="button button-icon" onClick={onClose} aria-label="Cerrar ventana"><Icon name="close"/></button></div>
    <div className="dialog-body">{children}</div>{footer && <div className="dialog-footer">{footer}</div>}
  </dialog>;
}
