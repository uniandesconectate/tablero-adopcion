"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { MIN_PROFESSORS, TEXTS } from "@/lib/data";
import { formatPeriod, formatProbability, share } from "@/lib/domain";
import { CONDITION_LABELS, STATES, type AdoptionState, type Condition, type PeriodId, type TeacherToolRecord } from "@/lib/types";

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
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
  building: <><path d="m3 9 9-6 9 6M3 21h18M5 9v12m5-12v12m4-12v12m5-12v12M2 9h20"/></>,
  leaf: <><path d="M20 3C9 2 2 7 5 15c8 5 15-1 15-12ZM4 21 16 8"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  book: <><path d="M12 5v16M3 3c4 0 7 0 9 2 2-2 5-2 9-2v16c-4 0-7 0-9 2-2-2-5-2-9-2V3Z"/></>,
  filter: <><path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/></>,
};

export function Icon({ name, size = 19 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.arrow}</svg>;
}
export const pct = (n: number, total: number) => total ? `${Math.round(n / total * 100)} %` : "—";
export const number = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(n);
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export const fewNote = `Con menos de ${MIN_PROFESSORS} profesores no se muestran porcentaje ni barra: pocos profesores.`;
export const stateDescriptions: Record<AdoptionState, string> = {
  "No expuesto": "Sin uso efectivo en la historia observada.",
  Adopta: "Primer uso efectivo; la continuidad está por confirmar.",
  Usa: "La herramienta se mantiene en periodos consecutivos.",
  Apropia: "Uso sostenido con intensidad por encima del corte de referencia.",
  Abandona: "Interrumpió una herramienta que antes usaba sostenidamente.",
  "Sin información": "La evidencia o la regla no permiten asignar un estado.",
};
export const conditionDescriptions: Record<Condition, string> = {
  regla: "Probó la herramienta un semestre y no siguió, o la retomó después de dejarla: el marco todavía no tiene un estado para estos casos.",
  dato: "Falta el dato de uso con estudiantes de ese semestre, o la historia no se puede comparar.",
  configuracion: "De esta herramienta solo se sabe si está configurada, no si sus estudiantes la usan.",
};
export function StateBadge({ state, label = state }: { state: AdoptionState; label?: string }) {
  return <span className="state-badge" data-state={state}><span className="state-dot" data-state={state}/>{label}</span>;
}
export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="panel-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 className="section-title">{title}</h2>{description && <p className="section-description">{description}</p>}</div>{action}</div>;
}
export function Metric({ label, value, detail, icon }: { label: string; value: ReactNode; detail?: ReactNode; icon?: string }) {
  return <div className="metric"><div className="metric-label">{label}{icon && <span className="metric-icon"><Icon name={icon}/></span>}</div><div className="metric-value">{value}</div>{detail && <div className="metric-detail">{detail}</div>}</div>;
}
// Real forecasts exist only at their origin period; elsewhere an empty list would read as "nobody".
export const offOrigin = (period: PeriodId) => TEXTS.forecastOrigin !== null && period !== TEXTS.forecastOrigin;
export function OffOrigin({ period, onGo }: { period: PeriodId; onGo: (period: PeriodId) => void }) {
  const origin = TEXTS.forecastOrigin;
  if (!origin || period === origin) return null;
  return <EmptyState title={`Solo hay pronóstico con origen ${formatPeriod(origin)}`} description={`El modelo estima, desde ${formatPeriod(origin)}, quién empezará a configurar cada herramienta la próxima vez que dicte. En ${formatPeriod(period)} no hay pronóstico.`} action={<button className="button button-secondary" onClick={() => onGo(origin)}>Ver {formatPeriod(origin)}</button>}/>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name="search" size={25}/></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
export function StateBars({ records, onSelect, compact = false }: { records: TeacherToolRecord[]; onSelect?: (state: AdoptionState) => void; compact?: boolean }) {
  const evaluated = records.filter(r => r.state !== "Sin información").length;
  // Each case without a framework state keeps its own count, outside the percentages.
  const cases = (Object.keys(CONDITION_LABELS) as Condition[]).map(c => [c, records.filter(r => r.condition === c).length] as const).filter(([, n]) => n);
  return <div className={`bar-list ${compact ? "is-compact" : ""}`}>
    {STATES.map(state => {
      const count = records.filter(r => r.state === state).length;
      const part = share(count, evaluated);
      const firstTime = state === "Adopta" || state === "No expuesto" ? records.filter(r => r.state === state && r.taughtSemesters === 1).length : 0;
      const content = <><span className="bar-label"><span className="state-dot" data-state={state}/>{state}</span><span className="bar-track"><span className="bar-fill" data-state={state} style={{ "--bar-width": `${(part.ratio ?? 0) * 100}%` } as CSSProperties}/></span><span className="bar-value">{count}<span>{part.ratio === null && evaluated ? `de ${evaluated}` : part.text}</span></span>{firstTime > 0 && <span className="bar-detail">{plural(firstTime, "dicta", "dictan")} por primera vez</span>}</>;
      return onSelect ? <button className="bar-row" key={state} data-state={state} onClick={() => onSelect(state)} aria-label={`${state}: ${count} de ${evaluated} profesores. Ver lista`}>{content}</button> : <div className="bar-row" key={state} data-state={state}>{content}</div>;
    })}
    <p className="bar-detail">{plural(evaluated, "profesor evaluable", "profesores evaluables")}{cases.map(([c, n]) => ` · ${CONDITION_LABELS[c]}: ${n}`).join("")}{evaluated > 0 && evaluated < MIN_PROFESSORS ? ` · ${fewNote}` : ""}</p>
  </div>;
}
export function Probability({ value, missing = "Sin estimación" }: { value: number | null; missing?: string }) {
  if (value === null) return <span className="muted small">{missing}</span>;
  return <div className="probability-cell"><span>{formatProbability(value)}</span><span className="probability-track"><span style={{width:`${value * 100}%`}}/></span></div>;
}
export function Dialog({ title, eyebrow, children, footer, onClose, wide = false }: { title: string; eyebrow?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean }) {
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
