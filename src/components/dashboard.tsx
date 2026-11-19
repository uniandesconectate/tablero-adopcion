"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DATA_SOURCE, FACULTIES, GROUPS, MIN_PROFESSORS, OBSERVATIONS, PROFESSORS, SELECTABLE_PERIODS, SELECTION_KEY, TEXTS, TOOLS, nextGroupProbabilities } from "@/lib/data";
import { activeRun, configuredLabel, exportSelectionCsv, facultyAt, formatPeriod, formatProbability, getRecord, getRecords, habitualRate, lastTaughtPeriod, share, stateLabel, summarize } from "@/lib/domain";
import { BANDS, CONDITION_LABELS, STATES, type AdoptionState, type Condition, type Filters, type PageProps, type PeriodId, type Selection, type TeacherToolRecord, type Tool, type ToolId, type ViewId } from "@/lib/types";
import { GroupsPage, PredictionsPage } from "./analytics-pages";
import { Dialog, EmptyState, Icon, Metric, OffOrigin, Probability, SectionHeading, StateBadge, StateBars, conditionDescriptions, fewNote, number, offOrigin, plural, stateDescriptions } from "./ui";

const DEFAULTS: Filters = { period: "202520", faculty: "Todos", tool: "rubricas", state: "Todos", group: "Todos", search: "", probability: "Todas" };
const NAV: { id: ViewId; name: string; icon: string; number: string }[] = [
  { id: "resumen", name: "Resumen", icon: "grid", number: "01" },
  { id: "herramientas", name: "Herramientas", icon: "tools", number: "02" },
  { id: "profesores", name: "Profesores", icon: "users", number: "03" },
  { id: "grupos", name: "Grupos similares", icon: "layers", number: "04" },
  { id: "predicciones", name: "Predicciones", icon: "trend", number: "05" },
];
// What "configurada" counts for each external tool (decision #4a), as k5_markov.py reads it.
// shortcut: texts copied from the exporter's sources; move them to the contract if those sources change.
const COUNTED: Partial<Record<ToolId, string>> = {
  lockdown: "Cuenta si algún cuestionario de sus aulas pide LockDown.",
  turnitin: "Cuenta si algún buzón de tareas de sus cursos tiene Turnitin, que puede venir de la plantilla del curso.",
  padlet: "Cuenta si aparece en alguna de sus aulas por cualquier vía, por ejemplo un enlace en un tema.",
  genially: "Cuenta si aparece en alguna de sus aulas por cualquier vía, por ejemplo un enlace en un tema.",
  feedbackfruits: "Cuenta si aparece en alguna de sus aulas por cualquier vía, por ejemplo un enlace en un tema.",
  voicethread: "Cuenta si aparece en alguna de sus aulas por cualquier vía. Solo se ve por enlace rápido y se reconoce de forma indirecta, así que la cifra puede quedarse corta.",
};
const USE_TOOLS = TOOLS.filter(t => t.evidence !== "configuracion");
const SHARED_KNOWN = OBSERVATIONS.some(row => row.shared !== null);
const isConfigOnly = (tool: Tool) => tool.evidence === "configuracion";
// A configuration-only tool has no framework state to filter by.
const listFilters = (filters: Filters): Filters => TOOLS.some(t => t.id === filters.tool && isConfigOnly(t)) ? { ...filters, state: "Todos" } : filters;
const badgeLabel = (record: TeacherToolRecord) => isConfigOnly(record.tool) ? `Solo configuración: ${configuredLabel(record.observation.configured)}` : stateLabel(record);
// Forecasts cover only tools not configured at the origin; tools without a model never reach this column.
const noForecast = (record: TeacherToolRecord) => record.observation.configured ? "Ya la tiene configurada" : "Sin estimación";
// Abandona now, with effective use in the previous semester that has data (semesters without data are skipped).
const leftNow = (record: TeacherToolRecord) => record.state === "Abandona" && record.history.filter(row => row.effective !== null).at(-2)?.effective === true;
const conditionsShown = (Object.keys(CONDITION_LABELS) as Condition[]).filter(c => c !== "configuracion" || USE_TOOLS.length < TOOLS.length);

function readLocation() {
  const params = new URLSearchParams(window.location.search);
  const filters = { ...DEFAULTS };
  const period = params.get("periodo");
  if (SELECTABLE_PERIODS.some(p => p === period)) filters.period = period as Filters["period"];
  const tool = params.get("herramienta");
  if (TOOLS.some(t => t.id === tool)) filters.tool = tool as ToolId;
  const faculty = params.get("facultad");
  if (faculty && FACULTIES.includes(faculty)) filters.faculty = faculty;
  const state = params.get("estado");
  if (state && [...STATES, "Sin información"].some(s => s === state)) filters.state = state as AdoptionState;
  const group = params.get("grupo");
  if (GROUPS.some(g => g.id === group)) filters.group = group as Filters["group"];
  const probability = params.get("probabilidad");
  if ([...BANDS, "Con estimación"].some(p => p === probability)) filters.probability = probability as Filters["probability"];
  filters.search = params.get("buscar") ?? "";
  const view = NAV.some(n => n.id === params.get("vista")) ? params.get("vista") as ViewId : "resumen";
  return { view, filters };
}

function locationFor(view: ViewId, filters: Filters) {
  const params = new URLSearchParams({ vista: view, periodo: filters.period, herramienta: filters.tool });
  if (filters.faculty !== "Todos") params.set("facultad", filters.faculty);
  if (filters.state !== "Todos") params.set("estado", filters.state);
  if (filters.group !== "Todos") params.set("grupo", filters.group);
  if (filters.probability !== "Todas") params.set("probabilidad", filters.probability);
  if (filters.search) params.set("buscar", filters.search);
  return `?${params.toString()}`;
}

export default function Dashboard() {
  const [view, setView] = useState<ViewId>("resumen");
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [selection, setSelection] = useState<Selection>({});
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"selection" | "method" | null>(null);
  const [professor, setProfessor] = useState<TeacherToolRecord | null>(null);
  const [toast, setToast] = useState("");
  const activeView = NAV.find(n => n.id === view)!;

  useEffect(() => {
    const initial = readLocation(); setView(initial.view); setFilters(initial.filters);
    try {
      const stored = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "{}");
      const valid: Selection = {};
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        for (const [id, tools] of Object.entries(stored)) {
          if (!PROFESSORS.some(p => p.id === id) || !Array.isArray(tools)) continue;
          const safeTools = [...new Set(tools.filter((t): t is ToolId => TOOLS.some(tool => tool.id === t)))];
          if (safeTools.length) valid[id] = safeTools;
        }
      }
      setSelection(valid);
    } catch { /* A damaged browser-local draft starts with an empty selection. */ }
    setReady(true);
    const pop = () => { const next = readLocation(); setView(next.view); setFilters(next.filters); };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem(SELECTION_KEY, JSON.stringify(selection)); } catch { /* Selection remains available in memory. */ } } }, [selection, ready]);
  useEffect(() => { if (ready) window.history.replaceState(null, "", locationFor(view, filters)); }, [view, filters, ready]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 3500); return () => clearTimeout(timer); }, [toast]);

  const onFilters = (patch: Partial<Filters>) => setFilters(current => ({ ...current, ...patch }));
  const onNavigate = (next: ViewId, patch: Partial<Filters> = {}) => {
    const nextFilters = { ...filters, ...patch };
    if (next !== view) window.history.pushState(null, "", locationFor(next, nextFilters));
    setFilters(nextFilters); setView(next); setMenuOpen(false);
    window.scrollTo({ top: 0 });
    setTimeout(() => document.querySelector<HTMLElement>("main h1")?.focus(), 0);
  };
  const toggle = (record: TeacherToolRecord) => setSelection(current => {
    const next = { ...current };
    const tools = current[record.professor.id] ?? [];
    const updated = tools.includes(record.tool.id) ? tools.filter(t => t !== record.tool.id) : [...tools, record.tool.id];
    if (updated.length) next[record.professor.id] = updated;
    else delete next[record.professor.id];
    return next;
  });
  const selectMany = (records: TeacherToolRecord[], add: boolean) => setSelection(current => {
    const next = { ...current };
    records.forEach(r => {
      const old = next[r.professor.id] ?? [];
      const tools = add ? [...new Set([...old, r.tool.id])] : old.filter(t => t !== r.tool.id);
      if (tools.length) next[r.professor.id] = tools; else delete next[r.professor.id];
    });
    return next;
  });
  const download = () => {
    const blob = new Blob([exportSelectionCsv(selection, filters.period)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = TEXTS.csvName(filters.period); anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setToast("La convocatoria se exportó con profesores únicos.");
  };
  const props: PageProps = { filters, onFilters, onNavigate, onProfessor: setProfessor, onMethod: () => setDialog("method") };
  const selectedCount = Object.keys(selection).length;
  const currentIds = new Set(getRecords(view === "profesores" ? listFilters(filters) : { period: filters.period, faculty: filters.faculty, tool: filters.tool }).map(r => r.professor.id));
  const outside = Object.keys(selection).filter(id => !currentIds.has(id)).length;

  return <div className="app-shell">
    <a className="skip-link" href="#contenido">Ir al contenido</a>
    {menuOpen && <button className="mobile-overlay" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Navegación principal">
      <a href="?vista=resumen" className="brand" onClick={event => { event.preventDefault(); onNavigate("resumen"); }}>
        <span className="brand-symbol" aria-hidden="true"><span/><span/><span/><span/></span><span className="brand-text">Conecta<span>—</span>TE<small className="brand-subtitle">Universidad de los Andes</small></span>
      </a>
      <div className="sidebar-label">Adopción y acompañamiento</div>
      <nav className="nav-list">{NAV.map(item => <button key={item.id} className="nav-item" aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><Icon name={item.icon}/><span>{item.name}</span><span className="nav-number" aria-hidden="true">{item.number}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Icon name="leaf" size={25}/><p>Los datos abren<br/><strong>conversaciones.</strong></p><span>El acompañamiento<br/>lo decides tú.</span></div><button className="text-link" onClick={() => setDialog("method")}><Icon name="info" size={16}/> Cómo leer este espacio</button><div className="sidebar-signature">DIDACTA <span>·</span> Conecta-TE</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="button button-icon mobile-menu" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu"/></button><span>Estrategias de adopción</span><Icon name="chevron" size={13}/><strong>{activeView.name}</strong></div><div className="topbar-actions"><span className="demo-badge"><span/> {TEXTS.badge}</span><button className="selection-button" onClick={() => setDialog("selection")}><Icon name="users" size={17}/><span>Convocatoria</span><strong>{selectedCount}</strong></button></div></header>
      <main id="contenido" className="workspace">
        <div className="global-filters"><span className="global-filters-label"><Icon name="calendar" size={16}/> Contexto de consulta</span><label className="field"><span className="sr-only">Periodo observado</span><select aria-label="Periodo observado" value={filters.period} onChange={e => onFilters({ period: e.target.value as Filters["period"] })}>{[...SELECTABLE_PERIODS].reverse().map(p => <option key={p} value={p}>{formatPeriod(p)}</option>)}</select></label><label className="field faculty-field"><span className="sr-only">Facultad</span><select aria-label="Facultad" value={filters.faculty} onChange={e => onFilters({ faculty: e.target.value })}><option value="Todos">Todas las facultades</option>{FACULTIES.map(f => <option key={f}>{f}</option>)}</select></label><span className="global-filters-note">Observado al cierre del periodo</span></div>
        <div key={view} className="page-content">
          {view === "resumen" && <SummaryPage {...props}/>}
          {view === "herramientas" && <ToolsPage {...props}/>}
          {view === "profesores" && <ProfessorsPage {...props} selection={selection} onToggle={toggle} onSelectMany={selectMany} onSelection={() => setDialog("selection")}/>}
          {view === "grupos" && <GroupsPage {...props}/>}
          {view === "predicciones" && <PredictionsPage {...props}/>}
        </div>
        <footer className="app-footer"><span>Conecta-TE <span aria-hidden="true">↗</span> Una mirada para acompañar</span><span>{DATA_SOURCE} <span>·</span> {formatPeriod(filters.period)}</span></footer>
      </main>
    </div>
    {dialog === "method" && <MethodDialog onClose={() => setDialog(null)}/>}
    {professor && <ProfessorDialog record={professor} selection={selection} onToggle={toggle} onClose={() => setProfessor(null)}/>}
    {dialog === "selection" && <SelectionDialog selection={selection} period={filters.period} outside={outside} onRemove={id => setSelection(current => { const next = { ...current }; delete next[id]; return next; })} onClear={() => setSelection({})} onExport={download} onClose={() => setDialog(null)}/>}
    {toast && <div className="toast" role="status"><Icon name="check"/>{toast}</div>}
  </div>;
}

function PageHeading({ index, title, description, action }: { index: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{index} / ACOMPAÑAMIENTO DOCENTE</p><h1 tabIndex={-1}>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}
function ToolSelect({ filters, onFilters }: Pick<PageProps, "filters" | "onFilters">) {
  return <label className="field"><span className="sr-only">Herramienta</span><select aria-label="Herramienta" value={filters.tool} onChange={e => onFilters({ tool: e.target.value as ToolId })}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>;
}

function ConfigurationShare({ tool, period, faculty }: { tool: Tool; period: PeriodId; faculty: string }) {
  // N = professors who taught with a known value: an unavailable external tool is unknown, not zero.
  const rows = SELECTABLE_PERIODS.filter(p => p <= period).map(p => {
    const taught = getRecords({ period: p, faculty, tool: tool.id });
    const known = taught.filter(r => r.observation.configured !== null);
    const configured = known.filter(r => r.observation.configured).length;
    return { period: p, configured, known: known.length, taught: taught.length, part: share(configured, known.length) };
  });
  return <div className="bar-list"><p className="small muted">Configurada en al menos un aula: es configuración, no uso con estudiantes. {COUNTED[tool.id] ?? ""} Para {tool.name} no se asigna un estado del marco.</p>{rows.map(row => <div className="bar-row" key={row.period}><span className="bar-label">{formatPeriod(row.period)}</span><span className="bar-track"><span className="bar-fill" style={{ "--bar-width": `${(row.part.ratio ?? 0) * 100}%` } as CSSProperties}/></span><span className="bar-value">{row.part.ratio === null && row.known ? row.configured : row.part.text}<span>{!row.known ? row.taught ? "no disponible" : "nadie dictó" : row.part.ratio === null ? `de ${row.known}` : `${row.configured}/${row.known}`}</span></span></div>)}<p className="bar-detail">Configurada en al menos un aula / profesores que dictaron con dato de configuración, en cada semestre.{rows.some(row => row.taught > row.known) && " No disponible: la herramienta no estaba activada para esos profesores ese semestre."}{rows.some(row => !row.taught) && " Nadie dictó: ningún profesor de este contexto dictó ese semestre."}{rows.some(row => row.known && row.part.ratio === null) && ` ${fewNote}`}</p></div>;
}

function SummaryPage({ filters, onFilters, onNavigate, onMethod }: PageProps) {
  const [reviewState, setReviewState] = useState<AdoptionState>("Adopta");
  const [mode, setMode] = useState<"rate" | "count">("rate");
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const configOnly = tool.evidence === "configuracion";
  const base = { period: filters.period, faculty: filters.faculty, state: "Todos" as const, group: "Todos" as const, probability: "Todas" as const, search: "" };
  // Configuration-only tools have no framework states to compare.
  const rows = USE_TOOLS.map(t => {
    const records = getRecords({ ...base, tool: t.id });
    const evaluated = records.filter(r => r.state !== "Sin información").length;
    const count = records.filter(r => r.state === reviewState).length;
    return { tool: t, records, evaluated, count, part: share(count, evaluated) };
  });
  const all = rows.flatMap(r => r.records);
  // One record per professor who taught in the period, so it doubles as the professor count.
  const records = getRecords({ ...base, tool: filters.tool });
  const evaluated = all.filter(r => r.state !== "Sin información").length;
  const fewProfessors = records.length < MIN_PROFESSORS;
  const onlyUse = USE_TOOLS.length < TOOLS.length ? ` · solo las ${USE_TOOLS.length} herramientas con datos de uso` : "";
  const adopting = records.filter(r => r.state === "Adopta").length;
  const firstTime = records.filter(r => r.state === "Adopta" && r.taughtSemesters === 1).length;
  // First uses are compared with those who could start: No expuesto or Adopta (decision #6b).
  const couldStart = records.filter(r => r.state === "No expuesto" || r.state === "Adopta").length;
  const started = share(adopting, couldStart);
  const abandoning = records.filter(r => r.state === "Abandona").length;
  const justLeft = records.filter(leftNow).length;
  const { configured, measurable } = summarize(records);
  const configuredPart = share(configured, measurable);
  const sorted = [...rows].sort((a, b) => mode === "rate" ? (b.evaluated ? b.count / b.evaluated : 0) - (a.evaluated ? a.count / a.evaluated : 0) : b.count - a.count);
  const open = (state: AdoptionState, toolId = filters.tool) => onNavigate("profesores", { tool: toolId, state, group: "Todos", search: "", probability: "Todas" });
  return <>
    <div className="hero-grid"><div className="hero-copy"><p className="eyebrow">01 / UNA MIRADA GENERAL</p><h1 tabIndex={-1}>Cada profesor,<br/>un siguiente paso.</h1><p className="page-description">Entiende cómo se incorporan las herramientas y encuentra dónde ofrecer acompañamiento.</p><button className="text-link" onClick={onMethod}>Cómo leer los estados <Icon name="arrow" size={16}/></button></div><div className="hero-card"><span className="hero-card-kicker"><Icon name="spark" size={17}/> DEL DATO A LA CONVERSACIÓN</span><h2>Una primera experiencia<br/>puede ir más lejos.</h2>{configOnly ? <p>Para {tool.name} solo hay datos de configuración, no de uso con estudiantes, así que no se asigna un estado del marco. {measurable ? <>Configurada en al menos un aula: <strong>{configured} de {measurable}</strong>.</> : records.length ? "Este semestre no hay dato de configuración: la herramienta no estaba activada." : "Ningún profesor de este contexto dictó este semestre."}</p> : <><p><strong>{plural(adopting, "profesor", "profesores")}</strong> {adopting === 1 ? "está" : "están"} en Adopta para {tool.name}{firstTime ? `; ${plural(firstTime, "dicta", "dictan")} por primera vez` : ""}. Revisa a quién acompañar para darle continuidad.</p><button className="button button-primary" onClick={() => open("Adopta")}>Revisar primeros usos <Icon name="arrow" size={17}/></button></>}<div className="hero-orbit" aria-hidden="true"/></div></div>
    <div className="metrics-grid"><Metric label="Profesores en el contexto" value={records.length} detail={`${filters.faculty === "Todos" ? "Todas las facultades" : filters.faculty} · personas únicas`} icon="users"/><Metric label="Cobertura de estados" value={fewProfessors ? `${evaluated} de ${all.length}` : share(evaluated, all.length).text} detail={`${fewProfessors ? "Pares profesor–herramienta evaluables · pocos profesores, sin porcentaje" : `${evaluated} de ${all.length} pares profesor–herramienta evaluables`}${onlyUse}`} icon="layers"/>{configOnly ? <Metric label="Configurada en al menos un aula" value={configuredPart.ratio === null && measurable ? `${configured} de ${measurable}` : configuredPart.text} detail={`${configuredPart.ratio === null ? measurable ? "Pocos profesores, sin porcentaje" : "Sin profesores con dato" : `${configured} de ${measurable} profesores con dato`} · configuración, no uso con estudiantes`} icon="leaf"/> : <Metric label={`Primeros usos en ${tool.name}`} value={adopting} detail={started.ratio === null ? couldStart ? `${adopting} de ${couldStart} que aún no la usaban · pocos profesores` : "Nadie que aún no la usara" : `${started.text} de quienes aún no la usaban (${adopting} de ${couldStart}, en No expuesto o Adopta)`} icon="leaf"/>}</div>
    <section className="panel"><SectionHeading eyebrow="COMPARAR PARA ENFOCAR" title="¿Dónde está la oportunidad?" description="Elige un estado y compara su presencia entre herramientas." action={<div className="segmented" aria-label="Medida de comparación"><button data-active={mode === "rate"} aria-pressed={mode === "rate"} onClick={() => setMode("rate")}>Porcentaje</button><button data-active={mode === "count"} aria-pressed={mode === "count"} onClick={() => setMode("count")}>Cantidad</button></div>}/><div className="panel-body"><div className="state-selector" aria-label="Estado a comparar">{STATES.map(state => <button key={state} className="state-filter" data-active={reviewState === state} aria-pressed={reviewState === state} onClick={() => setReviewState(state)}><span className="state-dot" data-state={state}/>{state}</button>)}</div><p className="small muted chart-caption">{stateDescriptions[reviewState]} Selecciona una barra para ver a sus profesores.</p><div className="bar-list tool-comparison">{sorted.map(row => <button className="bar-row" key={row.tool.id} onClick={() => open(reviewState, row.tool.id)} aria-label={`${row.tool.name}: ${row.count} de ${row.evaluated} en ${reviewState}. Ver profesores`}><span className="bar-label">{row.tool.name}</span><span className="bar-track"><span className="bar-fill" data-state={reviewState} style={{ "--bar-width": `${mode === "rate" ? (row.part.ratio ?? 0) * 100 : records.length ? row.count / records.length * 100 : 0}%` } as CSSProperties}/></span><span className="bar-value">{mode === "rate" && row.part.ratio !== null ? row.part.text : row.count}<span>{row.count} / {row.evaluated}</span></span><Icon name="arrowUp" size={16}/></button>)}</div><p className="bar-detail">Cada barra conserva su población evaluable. Los casos sin estado del marco («{CONDITION_LABELS.regla}» o «{CONDITION_LABELS.dato}») están excluidos del porcentaje y cuentan en la cobertura.{onlyUse && ` Se comparan solo las ${USE_TOOLS.length} herramientas con datos de uso; las de solo configuración no tienen estado del marco.`}{mode === "rate" && rows.some(row => row.evaluated && row.part.ratio === null) && ` ${fewNote}`}</p></div></section>
    <div className={configOnly ? "summary-bottom" : "two-column summary-bottom"}><section className="panel"><SectionHeading title="Una herramienta, distintos momentos" description="La adopción se observa por herramienta, no como una nota del profesor." action={<ToolSelect filters={filters} onFilters={onFilters}/>}/><div className="panel-body">{configOnly ? <ConfigurationShare tool={tool} period={filters.period} faculty={filters.faculty}/> : <StateBars records={records} onSelect={state => open(state)}/>}</div><div className="panel-footer"><button className="text-link" onClick={() => onNavigate("herramientas")}>Explorar {tool.name} <Icon name="arrow" size={16}/></button></div></section>{!configOnly && <aside className="panel accompaniment-note"><div className="panel-body"><span className="note-icon"><Icon name="clock" size={24}/></span><p className="eyebrow">TAMBIÉN MERECE UNA CONVERSACIÓN</p><h2>Volver a mirar<br/>una interrupción.</h2><p>{plural(abandoning, "profesor", "profesores")} en Abandona para {tool.name}; {justLeft} la {justLeft === 1 ? "dejó" : "dejaron"} este semestre. En Abandona están quienes dejaron de usarla con sus estudiantes después de un uso sostenido. El dato invita a preguntar qué cambió.</p><button className="button button-secondary" onClick={() => open("Abandona")}>Revisar interrupciones <Icon name="arrow" size={16}/></button></div></aside>}</div>
  </>;
}

function ToolsPage(props: PageProps) {
  const { filters, onFilters, onNavigate, onProfessor, onMethod } = props;
  const [tab, setTab] = useState("observado");
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const [ruleTitle, rule] = TEXTS.toolRule(tool);
  const records = getRecords({ period: filters.period, faculty: filters.faculty, tool: filters.tool });
  const [trendState, setTrendState] = useState<AdoptionState>("Usa");
  const periods = SELECTABLE_PERIODS.filter(p => p <= filters.period);
  const trends = periods.map(period => { const rows = getRecords({ period, faculty: filters.faculty, tool: filters.tool }); return { period, count: rows.filter(r => r.state === trendState).length, n: rows.filter(r => r.state !== "Sin información").length }; });
  // Configuration-only tools have no Adopta or Abandona, so their examples are those with it configured.
  const examples = isConfigOnly(tool) ? records.filter(r => r.observation.configured) : records.filter(r => r.state === "Adopta" || r.state === "Abandona");
  const open = (state: AdoptionState) => onNavigate("profesores", { state, group: "Todos", search: "", probability: "Todas" });
  return <><PageHeading index="02" title="El uso tiene distintos momentos." description="Explora una herramienta y reconoce qué acompañamiento puede tener sentido." action={<button className="button button-secondary" onClick={onMethod}><Icon name="info" size={17}/> Entender los estados</button>}/><div className="tool-tabs" aria-label="Herramientas">{TOOLS.map(t => <button className="tool-tab" key={t.id} data-active={t.id === filters.tool} aria-pressed={t.id === filters.tool} onClick={() => onFilters({ tool: t.id, state: "Todos", probability: "Todas" })}>{t.name}</button>)}</div><div className="tool-heading"><div><p className="eyebrow">HERRAMIENTA SELECCIONADA</p><h2>{tool.name}</h2><p className="muted">{tool.description}</p></div><div className="segmented" aria-label="Tipo de información"><button data-active={tab === "observado"} aria-pressed={tab === "observado"} onClick={() => setTab("observado")}>Lo observado</button><button data-active={tab === "previsto"} aria-pressed={tab === "previsto"} onClick={() => setTab("previsto")}>Lo previsto</button></div></div>
    {tab === "observado" ? <>{tool.evidence === "configuracion" ? <section className="panel"><SectionHeading title="¿Quiénes la tienen configurada?" description={`Por semestre, hasta ${formatPeriod(filters.period)}`}/><div className="panel-body"><ConfigurationShare tool={tool} period={filters.period} faculty={filters.faculty}/></div></section> : <div className="two-column"><section className="panel"><SectionHeading title="¿En qué momento están?" description={`Estado por profesor · ${formatPeriod(filters.period)}`}/><div className="panel-body"><StateBars records={records} onSelect={open}/><button className="text-link" onClick={() => open("Sin información")}>Ver casos sin estado del marco <Icon name="arrow" size={15}/></button></div></section><section className="panel"><SectionHeading title="Cómo cambia en el tiempo" description="La misma definición, aplicada a cada periodo." action={<label className="field"><span className="sr-only">Estado de la evolución</span><select aria-label="Estado de la evolución" value={trendState} onChange={e => setTrendState(e.target.value as AdoptionState)}>{STATES.map(s => <option key={s}>{s}</option>)}</select></label>}/><div className="panel-body"><div className="trend-bars">{trends.map(row => <button key={row.period} className="trend-column" aria-label={`${formatPeriod(row.period)}: ${row.count} de ${row.n} en ${trendState}`} onClick={() => onNavigate("profesores", { period: row.period, state: trendState, group: "Todos", search: "", probability: "Todas" })}><span className="trend-number">{row.count}</span><span className="trend-track"><span data-state={trendState} className="bar-fill" style={{height:`${(share(row.count, row.n).ratio ?? 0) * 100}%`}}/></span><span className="trend-label">{formatPeriod(row.period)}</span><span className="small muted">{row.count}/{row.n}</span></button>)}</div><p className="bar-detail">Altura = proporción de profesores evaluables. Cada periodo tiene su propio denominador.{trends.some(row => row.n && row.n < MIN_PROFESSORS) && ` ${fewNote}`}</p></div></section></div>}<section className="panel"><SectionHeading title="Ponerle contexto a los datos" description="La conversación empieza por una persona." action={<button className="text-link" onClick={() => onNavigate("profesores", { state: "Todos", group: "Todos", search: "", probability: "Todas" })}>Ver todos los profesores <Icon name="arrow" size={16}/></button>}/><RecordTable records={examples.slice(0, 5)} onProfessor={onProfessor}/></section><div className="callout"><Icon name="info"/><p><strong>{ruleTitle}</strong> {rule}</p></div></> : <><div className="callout"><Icon name="trend"/><p><strong>El pronóstico disponible estima configuración.</strong> No predice los estados Adopta, Usa, Apropia o Abandona del marco.</p></div><div className="panel"><SectionHeading title="¿Quién podría empezar a configurar?" description={TEXTS.estimates} action={<button className="button button-secondary" onClick={() => onNavigate("predicciones")}>Ver predicciones <Icon name="arrow" size={16}/></button>}/>{tool.forecast === false ? <EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no hay pronóstico de empezar a configurar.`}/> : offOrigin(filters.period) ? <OffOrigin period={filters.period} onGo={period => onFilters({ period })}/> : <RecordTable records={records.filter(r => r.probability !== null).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0)).slice(0, 6)} onProfessor={onProfessor} showProbability antecedent/>}</div></>}
  </>;
}

/** `antecedent` swaps the guidance column for the configuration background that comes with each forecast. */
function RecordTable({ records, onProfessor, selection, onToggle, onSelectMany, showProbability = false, antecedent = false }: { records: TeacherToolRecord[]; onProfessor: (record: TeacherToolRecord) => void; selection?: Selection; onToggle?: (record: TeacherToolRecord) => void; onSelectMany?: (records: TeacherToolRecord[], add: boolean) => void; showProbability?: boolean; antecedent?: boolean }) {
  const allChecked = records.length > 0 && records.every(r => selection?.[r.professor.id]?.includes(r.tool.id));
  const someChecked = records.some(r => selection?.[r.professor.id]?.includes(r.tool.id));
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = someChecked && !allChecked; }, [someChecked, allChecked]);
  if (!records.length) return <EmptyState title="No hay profesores con estos criterios" description="Prueba otro estado, herramienta o facultad para continuar la consulta."/>;
  // Configuration-only tools get no guidance (decision #13); every row is the same tool.
  const guided = !antecedent && !isConfigOnly(records[0].tool);
  return <div className="table-wrap"><table className="data-table"><thead><tr>{selection && <th className="checkbox-cell"><input ref={checkbox} type="checkbox" aria-label="Seleccionar profesores de esta página" checked={allChecked} onChange={e => onSelectMany?.(records, e.target.checked)}/></th>}<th>Profesor</th><th>Estado en la herramienta</th>{showProbability && <th>Empezar a configurar</th>}{antecedent && <th>Antecedente de configuración</th>}{guided && <th>Orientación de acompañamiento<span className="th-note">Sugerencia provisional, por validar con Conecta-TE</span></th>}<th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{records.map(record => <tr key={record.professor.id} data-selected={selection?.[record.professor.id]?.includes(record.tool.id) || undefined}>{selection && <td className="checkbox-cell"><input type="checkbox" aria-label={`Seleccionar a ${record.professor.name}`} checked={selection[record.professor.id]?.includes(record.tool.id) ?? false} onChange={() => onToggle?.(record)}/></td>}<td><button className="person-cell person-button" onClick={() => onProfessor(record)}><span className="avatar">{record.professor.initials}</span><span><span className="person-name">{record.professor.name}</span><span className="person-meta">{record.faculty}</span></span></button></td><td><StateBadge state={record.state} label={badgeLabel(record)}/></td>{showProbability && <td><Probability value={record.probability} missing={noForecast(record)}/></td>}{antecedent && <td className="table-reason">{record.forecastReason ?? "—"}</td>}{guided && <td className="table-reason">{guidance(record.state)}</td>}<td><button className="button button-icon" aria-label={`Ver ficha de ${record.professor.name}`} onClick={() => onProfessor(record)}><Icon name="arrowUp" size={17}/></button></td></tr>)}</tbody></table></div>;
}

function ProfessorsPage(props: PageProps & { selection: Selection; onToggle: (record: TeacherToolRecord) => void; onSelectMany: (records: TeacherToolRecord[], add: boolean) => void; onSelection: () => void }) {
  const { filters, onFilters, selection, onToggle, onSelectMany, onProfessor, onSelection } = props;
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const configOnly = isConfigOnly(tool);
  // Forecasts exist only at their origin and only for tools with a model (decision #15).
  const forecastHere = tool.forecast !== false && !offOrigin(filters.period);
  // Arriving with a probability filter (such as «Ver lista» from Predicciones) lists by probability.
  const [sort, setSort] = useState(filters.probability !== "Todas" ? "probability" : "name");
  const [page, setPage] = useState(1);
  const records = getRecords(listFilters(filters));
  const byProbability = forecastHere && sort === "probability";
  const sorted = useMemo(() => [...records].sort((a, b) => byProbability ? (b.probability ?? -1) - (a.probability ?? -1) || a.professor.name.localeCompare(b.professor.name, "es") : a.professor.name.localeCompare(b.professor.name, "es")), [records, byProbability]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / 10));
  const currentPage = Math.min(page, pageCount);
  const visible = sorted.slice((currentPage - 1) * 10, currentPage * 10);
  useEffect(() => setPage(1), [filters, sort]);
  const rate = habitualRate(tool.id);
  const origin = TEXTS.forecastOrigin;
  const chosen = Object.keys(selection).length;
  const chosenVisible = Object.keys(selection).filter(id => records.some(r => r.professor.id === id)).length;
  const reset = () => onFilters({ state: "Todos", group: "Todos", search: "", probability: "Todas" });
  return <><PageHeading index="03" title="El acompañamiento tiene nombre." description="Revisa la evidencia, elige a quién conversar y prepara una convocatoria." action={<button className="button button-primary" onClick={onSelection}><Icon name="users" size={17}/> Revisar convocatoria <span>{chosen}</span></button>}/><section className="panel"><div className="panel-body filters-grid"><label className="field search-field"><span className="field-label">Buscar profesor</span><span className="search-input"><Icon name="search" size={17}/><input type="search" aria-label="Buscar profesor" placeholder={TEXTS.searchPlaceholder} value={filters.search} onChange={e => onFilters({ search: e.target.value })}/></span></label><label className="field"><span className="field-label">Herramienta</span><select aria-label="Herramienta" value={filters.tool} onChange={e => onFilters({ tool: e.target.value as ToolId })}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="field"><span className="field-label">Estado de adopción</span><select aria-label="Estado de adopción" value={configOnly ? "Todos" : filters.state} disabled={configOnly} onChange={e => onFilters({ state: e.target.value as Filters["state"] })}><option value="Todos">{configOnly ? "Solo configuración" : "Todos los estados"}</option>{[...STATES, "Sin información"].map(s => <option key={s} value={s}>{s === "Sin información" ? "Sin estado del marco" : s}</option>)}</select></label><label className="field"><span className="field-label">Grupo de partida</span><select aria-label="Grupo de partida" value={filters.group} onChange={e => onFilters({ group: e.target.value as Filters["group"] })}><option value="Todos">Todos los grupos</option>{GROUPS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label></div><div className="panel-footer filter-secondary">{forecastHere ? <label className="field inline-field"><span className="field-label">Probabilidad de empezar a configurar</span><select aria-label="Rango de probabilidad" value={filters.probability} onChange={e => onFilters({ probability: e.target.value as Filters["probability"] })}><option value="Todas">Todos los rangos</option><option value="Con estimación">Con estimación</option>{[...BANDS].reverse().map(band => <option key={band} value={band}>{TEXTS.bands[band]}</option>)}</select>{TEXTS.relativeBands && rate !== null && <span className="small muted">Lo habitual: {formatProbability(rate)} empezó a configurar {tool.name} en la evaluación del modelo.</span>}</label> : <span className="small muted">{tool.forecast === false || !origin ? "Sin modelo para esta herramienta: no hay probabilidad de empezar a configurarla." : <>Solo hay pronóstico con origen {formatPeriod(origin)}. <button className="text-link" onClick={() => onFilters({ period: origin })}>Ver {formatPeriod(origin)}</button></>}</span>}<button className="text-link" onClick={reset}>Limpiar filtros de la lista</button></div></section>
    <div className="list-context"><div><h2>{records.length} profesores <span className="muted">· {tool.name}</span></h2><p className="small muted">{configOnly ? "Solo configuración" : filters.state === "Todos" ? "Todos los estados" : filters.state === "Sin información" ? "Sin estado del marco" : filters.state} · {formatPeriod(filters.period)}{filters.group !== "Todos" ? ` · grupo de partida: ${GROUPS.find(g => g.id === filters.group)?.name}` : ""}</p></div><label className="field inline-field"><span className="field-label">Orden de consulta</span><select aria-label="Orden de consulta" value={byProbability ? "probability" : "name"} onChange={e => setSort(e.target.value)}><option value="name">Nombre A–Z</option>{forecastHere && <option value="probability">Probabilidad de configuración</option>}</select></label></div>
    <section className="panel">{filters.probability !== "Todas" && !forecastHere ? tool.forecast === false ? <EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no hay probabilidad de empezar a configurar.`} action={<button className="button button-secondary" onClick={() => onFilters({ probability: "Todas" })}>Quitar el filtro de probabilidad</button>}/> : <OffOrigin period={filters.period} onGo={period => onFilters({ period })}/> : <RecordTable records={visible} onProfessor={onProfessor} selection={selection} onToggle={onToggle} onSelectMany={onSelectMany} showProbability={forecastHere}/>}{records.length > 0 && <div className="pagination"><span>{(currentPage - 1) * 10 + 1}–{Math.min(currentPage * 10, records.length)} de {records.length} profesores</span><div><button className="button button-secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior">Anterior</button><span>{currentPage} / {pageCount}</span><button className="button button-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Página siguiente">Siguiente</button></div></div>}</section>
    <div className="callout"><Icon name="info"/><p><strong>Seleccionar para acompañar.</strong> La probabilidad se refiere a empezar a configurar, no al beneficio del taller ni al mérito del profesor. “Sin estimación” conserva su significado; no equivale a cero.</p></div>
    {chosen > 0 && <div className="selection-tray"><div><Icon name="check"/><strong>{chosen} profesores en la convocatoria</strong><span>{chosenVisible} en esta lista · {chosen - chosenVisible} fuera de los filtros</span></div><button className="button button-primary" onClick={onSelection}>Revisar selección <Icon name="arrow" size={16}/></button></div>}
  </>;
}

function guidance(state: AdoptionState) {
  const labels: Record<AdoptionState, string> = { "No expuesto": "Explorar un primer acercamiento", Adopta: "Acompañar la continuidad", Usa: "Explorar una profundización", Apropia: "Revisar necesidades específicas", Abandona: "Conversar sobre la interrupción", "Sin información": "Completar el contexto" };
  return labels[state];
}

function ProfessorDialog({ record, selection, onToggle, onClose }: { record: TeacherToolRecord; selection: Selection; onToggle: (record: TeacherToolRecord) => void; onClose: () => void }) {
  const [toolId, setToolId] = useState(record.tool.id);
  const row = toolId === record.tool.id ? record : getRecord(record.professor.id, toolId, record.period);
  const selected = selection[row.professor.id]?.includes(row.tool.id) ?? false;
  const activeIntensities = activeRun(row).map(o => o.intensity).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const mid = Math.floor(activeIntensities.length / 2);
  const median = activeIntensities.length ? activeIntensities.length % 2 ? activeIntensities[mid] : (activeIntensities[mid - 1] + activeIntensities[mid]) / 2 : null;
  const nextGroups = nextGroupProbabilities(row.professor.id, row.period);
  const configOnly = isConfigOnly(row.tool);
  const { effective, reach, configured, shared } = row.observation;
  return <Dialog title={row.professor.name} eyebrow={`FICHA DE ACOMPAÑAMIENTO · ${row.professor.id}`} onClose={onClose} wide footer={<><span className="small muted">{TEXTS.identity}</span><button className="button button-primary" onClick={() => onToggle(row)}><Icon name={selected ? "check" : "plus"} size={17}/>{selected ? "Quitar de la convocatoria" : "Añadir a la convocatoria"}</button></>}>
    <div className="detail-profile"><span className="avatar avatar-large">{row.professor.initials}</span><div><p>{row.faculty}</p><p className="muted small">{row.professor.department} · {GROUPS.find(g => g.id === row.professor.groupByPeriod[row.period])?.name}</p></div></div><div className="toolbar"><label className="field"><span className="field-label">Herramienta de la ficha</span><select aria-label="Herramienta de la ficha" value={toolId} onChange={e => setToolId(e.target.value as ToolId)}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><StateBadge state={row.state} label={badgeLabel(row)}/></div><p className="detail-reason">{row.reason}{configOnly && COUNTED[row.tool.id] ? ` ${COUNTED[row.tool.id]}` : ""}</p>
    <div className="evidence-grid"><div className="evidence-item"><span>Uso efectivo actual</span><strong>{effective === null ? "Sin información" : effective ? "Registrado" : "Sin registro"}</strong>{effective && reach !== null && <small>Alcance: {formatProbability(reach)} de sus estudiantes tuvo actividad</small>}</div><div className="evidence-item"><span>Continuidad observada</span><strong>{configOnly || row.condition === "dato" ? "Sin información" : plural(row.sustainedPeriods, "periodo", "periodos")}</strong></div><div className="evidence-item"><span>Mediana del tramo activo</span><strong>{median === null ? "Sin dato" : number(median)}</strong><small>{TEXTS.intensity(row.tool.threshold)}</small></div><div className="evidence-item"><span>Configuración actual</span><strong>{configured === null ? "Sin información" : configured ? "Registrada" : "No registrada"}</strong></div></div>
    {shared && <p className="small muted">Todas sus aulas de este semestre son compartidas con otros docentes: la herramienta cuenta para cada docente del aula, aunque tal vez la configuró otra persona.</p>}
    <h3 className="detail-section-title">Su recorrido en {row.tool.name}</h3><div className="history-strip">{row.history.map(o => { const past = getRecord(row.professor.id, row.tool.id, o.period); return <div className="history-item" key={o.period}><span className="small muted">{formatPeriod(o.period)}</span><StateBadge state={past.state} label={configOnly ? `Configurada: ${configuredLabel(o.configured)}` : stateLabel(past)}/>{!SELECTABLE_PERIODS.includes(o.period) && <p>historia corta</p>}</div>; })}</div>
    <div className="action-card"><span className="eyebrow">{configOnly ? "TALLER" : "ORIENTACIÓN POR ESTADO"} · SUGERENCIA PROVISIONAL, POR VALIDAR CON CONECTA-TE</span>{!configOnly && <h3>{guidance(row.state)}</h3>}<p>{row.tool.workshop}</p><p className="small muted">La pertinencia del taller se confirma con el profesor y su contexto de curso. Este tablero no estima el efecto del acompañamiento.</p></div><details className="detail-disclosure"><summary>Consultar el pronóstico disponible</summary>{row.tool.forecast === false ? <p>Sin modelo para esta herramienta.</p> : offOrigin(row.period) ? <p>Solo hay pronóstico con origen {formatPeriod(TEXTS.forecastOrigin!)}. En {formatPeriod(row.period)} no hay pronóstico.</p> : <><p>Probabilidad de empezar a configurar {row.tool.name} la próxima vez que dicte:</p><Probability value={row.probability} missing={noForecast(row)}/><p className="small muted">{TEXTS.estimate}, distinta del estado de adopción. No predice apropiación ni beneficio del taller.</p></>}</details>
    {nextGroups && <details className="detail-disclosure"><summary>Grupo la próxima vez que dicte (estimado)</summary><div className="bar-list is-compact next-groups">{GROUPS.map((group, i) => <div className="bar-row" key={group.id}><span className="bar-label">{group.name}</span><span className="bar-track"><span className="bar-fill" style={{ "--bar-width": `${nextGroups[i] * 100}%` } as CSSProperties}/></span><span className="bar-value">{Math.round(nextGroups[i] * 100)} %</span></div>)}<p className="bar-detail">Probabilidad de cada grupo si vuelve a dictar el semestre siguiente. Los grupos son nominales: describen combinaciones de herramientas, no niveles ni calificaciones.</p></div></details>}
  </Dialog>;
}

function SelectionDialog({ selection, period, outside, onRemove, onClear, onExport, onClose }: { selection: Selection; period: Filters["period"]; outside: number; onRemove: (id: string) => void; onClear: () => void; onExport: () => void; onClose: () => void }) {
  // No data gives a workshop quota, so it starts empty and only the person preparing the call sets it.
  const [capacity, setCapacity] = useState<number | null>(null);
  const selected = PROFESSORS.filter(p => selection[p.id]?.length);
  const [clearConfirm, setClearConfirm] = useState(false);
  return <Dialog title="Tu próxima convocatoria" eyebrow="SELECCIÓN PARA REVISIÓN" onClose={onClose} wide footer={<><button className="text-link" disabled={!selected.length} onClick={() => { if (clearConfirm) { onClear(); setClearConfirm(false); } else setClearConfirm(true); }}>{clearConfirm ? "Confirmar vaciar selección" : "Vaciar selección"}</button><button className="button button-primary" disabled={!selected.length} onClick={onExport}><Icon name="download" size={17}/> Exportar {selected.length} profesores</button></>}>
    <p className="muted">Revisa personas y herramientas antes de preparar la invitación. El archivo incluye toda la selección, también los profesores fuera de los filtros actuales. Los estados exportados corresponden al periodo de consulta {formatPeriod(period)}; quien no dictó ese semestre sale con el estado de su último semestre dictado, con ese semestre al lado.</p><div className="selection-summary"><div><strong>{selected.length}</strong><span>profesores únicos</span></div><div><strong>{selected.reduce((n, p) => n + selection[p.id].length, 0)}</strong><span>herramientas asociadas</span></div><label className="field"><span className="field-label">Cupo orientativo</span><input type="number" aria-label="Cupo orientativo" min="1" max="500" placeholder="Sin cupo" value={capacity ?? ""} onChange={e => setCapacity(e.target.value === "" ? null : Math.max(1, Math.min(500, Number(e.target.value) || 1)))}/></label></div>{capacity !== null && selected.length > capacity && <div className="callout"><Icon name="info"/><p>La selección supera el cupo en {selected.length - capacity} personas. Puedes ajustarla antes de exportar.</p></div>}{outside > 0 && <p className="small muted">{outside} profesores de la selección están fuera de los filtros actuales.</p>}
    {selected.length ? <div className="selection-list">{selected.map(p => { const at = lastTaughtPeriod(p, period); return <div className="selection-item" key={p.id}><span className="avatar">{p.initials}</span><div><strong>{p.name}</strong><p className="small muted">{facultyAt(p, period)}{at === period ? "" : at ? ` · no dictó en ${formatPeriod(period)}: se exporta su estado de ${formatPeriod(at)}` : ` · no había dictado hasta ${formatPeriod(period)}`}</p><div className="selected-tools">{TOOLS.filter(t => selection[p.id].includes(t.id)).map(t => <span key={t.id}>{t.name}</span>)}</div></div><button className="button button-icon" onClick={() => onRemove(p.id)} aria-label={`Retirar a ${p.name}`}><Icon name="close" size={16}/></button></div>; })}</div> : <EmptyState title="La convocatoria empieza con una persona" description="En Profesores puedes seleccionar a quienes quieras revisar para un acompañamiento." action={<button className="button button-secondary" onClick={onClose}>Volver a la consulta</button>}/>}
    <p className="small muted">La convocatoria es un borrador guardado en este navegador. {TEXTS.selection} Exportar no envía invitaciones.</p>
  </Dialog>;
}

function MethodDialog({ onClose }: { onClose: () => void }) {
  return <Dialog title="Una herramienta, distintos momentos" eyebrow="CÓMO LEER ESTE ESPACIO" onClose={onClose} wide><p>El marco del proyecto se inspira en DigCompEdu y describe el estado de cada profesor en cada herramienta. Una misma persona puede tener estados distintos según la herramienta.</p><div className="method-states">{STATES.map(s => <div key={s}><StateBadge state={s}/><p>{stateDescriptions[s]}</p></div>)}{conditionsShown.map(c => <div key={c}><StateBadge state="Sin información" label={CONDITION_LABELS[c]}/><p>{conditionDescriptions[c]}</p></div>)}</div><div className="callout"><Icon name="info"/><p><strong>Configuración y uso efectivo son evidencias distintas.</strong> El pronóstico disponible estima empezar a configurar. No equivale a predecir los estados del marco.</p></div><details open><summary>{TEXTS.rulesTitle}</summary>{TEXTS.rules.map(text => <p key={text}>{text}</p>)}<p>{conditionsShown.map(c => `«${CONDITION_LABELS[c]}»`).join(", ").replace(/, ([^,]*)$/, " y $1")} no son etapas del marco: quedan fuera de los porcentajes, cada caso con su número y su explicación. No se convierten automáticamente en abandono.</p>{SHARED_KNOWN && <p>Cuando varios docentes dictan la misma aula, la herramienta cuenta para cada uno, aunque tal vez la configuró una sola persona. La ficha lo avisa cuando todas las aulas del profesor en ese semestre son compartidas.</p>}</details><details><summary>Cómo se toman las decisiones de visualización</summary><p>Seguimos el modelo de Tamara Munzner: entender la decisión de Conecta-TE, definir datos y tareas, elegir representaciones e interacciones y comprobar su consistencia. Las barras facilitan comparar cantidades; las tablas permiten revisar y seleccionar personas. Los grupos de uso son categorías descriptivas y no tienen orden de mérito.</p></details><p className="small muted">{TEXTS.method} No mide calidad docente, aprendizaje ni el efecto causal de un taller.</p></Dialog>;
}
