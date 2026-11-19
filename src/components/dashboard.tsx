"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DATA_SOURCE, FACULTIES, GROUPS, MIN_PROFESSORS, OBSERVATIONS, PERIODS, PROFESSORS, SELECTABLE_PERIODS, SELECTION_KEY, TEXTS, TOOLS, VALIDATION_ROWS, nextGroupProbabilities, onSource } from "@/lib/data";
import { COUNTED, DEFAULT_PERIOD, DEFAULT_TOOL, GUIDANCE, byCode, byProbability, configuredLabel, exportSelectionCsv, facultyAt, facultyLong, formatPeriod, formatProbability, getRecord, getRecords, habitualRate, lastTaughtPeriod, plainLabel, plainReason, probabilityBandFor, selectionState, share, summarize, typicalIntensity } from "@/lib/domain";
import { BANDS, CASE_LABELS, CONDITION_LABELS, STATES, type AdoptionState, type Condition, type Filters, type GuideSection, type PageProps, type PeriodId, type Professor, type Selection, type TeacherToolRecord, type Tool, type ToolId, type ViewId } from "@/lib/types";
import { GroupsPage, PredictionsPage } from "./analytics-pages";
import { Dialog, EmptyState, Icon, Metric, OffOrigin, PersonIcon, Probability, SINCE, STATE_PLAIN, STATE_SHORT, SectionHeading, StateBadge, StateBars, TARGET, bandText, conditionDescriptions, fewNote, nextTerm, number, offOrigin, plural, stateDescriptions, workshopNote } from "./ui";

const CONFIGURED_OPTIONS = { si: "Sí", no: "No", "sin-dato": "Sin dato" } as const;
const STEPS_KEY = "conectate-pasos-vistos";
// Values taken from the open file, recomputed for each file.
let DEFAULTS: Filters;
let NAV: { id: ViewId; name: string; icon: string; number: string }[] = [];
let USE_TOOLS: Tool[] = [];
let SHARED_KNOWN = false;
let EARLY: string[] = [];
let conditionsShown: Condition[] = [];
onSource(() => {
  DEFAULTS = { period: DEFAULT_PERIOD, faculty: "Todos", tool: DEFAULT_TOOL, state: "Todos", group: "Todos", search: "", probability: "Todas", configured: "Todos" };
  NAV = [
    { id: "resumen", name: "Resumen", icon: "grid", number: "01" },
    { id: "herramientas", name: "Talleres y herramientas", icon: "tools", number: "02" },
    { id: "profesores", name: "Elegir profesores", icon: "users", number: "03" },
    { id: "grupos", name: "Grupos parecidos", icon: "layers", number: "04" },
    { id: "predicciones", name: TARGET ? `Pronóstico ${formatPeriod(TARGET)}` : "Pronóstico", icon: "trend", number: "05" },
  ];
  USE_TOOLS = TOOLS.filter(t => t.evidence !== "configuracion");
  SHARED_KNOWN = OBSERVATIONS.some(row => row.shared !== null);
  EARLY = PERIODS.filter(p => !SELECTABLE_PERIODS.includes(p)).map(formatPeriod);
  conditionsShown = (Object.keys(CONDITION_LABELS) as Condition[]).filter(c => c !== "configuracion" || USE_TOOLS.length < TOOLS.length);
});
const isConfigOnly = (tool: Tool) => tool.evidence === "configuracion";
/** Changing the tool clears the filters that only make sense for the previous one, in every view. */
const toolPatch = (tool: ToolId): Partial<Filters> => ({ tool, state: "Todos", probability: "Todas", configured: "Todos" });
const listPatch: Partial<Filters> = { state: "Todos", group: "Todos", search: "", probability: "Todas", configured: "Todos" };
// A configuration-only tool has no framework state; a tool with states offers no configuration filter.
const listFilters = (filters: Filters): Filters => TOOLS.some(t => t.id === filters.tool && isConfigOnly(t)) ? { ...filters, state: "Todos" } : { ...filters, configured: "Todos" };
const badgeLabel = (record: TeacherToolRecord) => isConfigOnly(record.tool) ? `Configurada: ${configuredLabel(record.observation.configured)}` : plainLabel(record);
const caseNote: Record<Condition, string> = { regla: "las reglas aún no cubren su caso", dato: "falta información para darle estado", configuracion: "" };
// Forecasts cover only tools not configured at the origin; tools without a model never reach this column.
const noForecast = (record: TeacherToolRecord) => record.observation.configured ? `Ya la tiene configurada en ${formatPeriod(record.period)}` : "Sin estimación (no es 0 %)";
// Abandona now, with effective use in the previous semester that has data (semesters without data are skipped).
const leftNow = (record: TeacherToolRecord) => record.state === "Abandona" && record.history.filter(row => row.effective !== null).at(-2)?.effective === true;
const facultyText = (faculty: string) => faculty === "Todos" ? "Todas las facultades" : facultyLong(faculty);
const CONFIG_HELP = "Configurada: la herramienta está puesta en al menos un aula del profesor (la haya puesto él u otro docente del aula). Uso con estudiantes: además, al menos un estudiante hizo algo en ella (basta uno). Son cosas distintas: un profesor puede tenerla configurada sin que sus estudiantes la usen.";

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
  const configured = params.get("configurada");
  if (configured && Object.prototype.hasOwnProperty.call(CONFIGURED_OPTIONS, configured)) filters.configured = configured as Filters["configured"];
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
  if (filters.configured !== "Todos") params.set("configurada", filters.configured);
  if (filters.search) params.set("buscar", filters.search);
  return `?${params.toString()}`;
}

/** The whole dashboard for the open file; `onChangeFile` goes back to the start screen. */
export default function Dashboard({ onChangeFile }: { onChangeFile: () => void }) {
  const [view, setView] = useState<ViewId>("resumen");
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [selection, setSelection] = useState<Selection>({});
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"selection" | "method" | null>(null);
  const [guideSection, setGuideSection] = useState<GuideSection | undefined>();
  const [professor, setProfessor] = useState<TeacherToolRecord | null>(null);
  const [downloaded, setDownloaded] = useState("");
  const activeView = NAV.find(n => n.id === view)!;
  const tool = TOOLS.find(t => t.id === filters.tool)!;

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

  const onFilters = (patch: Partial<Filters>) => setFilters(current => ({ ...current, ...patch }));
  const onNavigate = (next: ViewId, patch: Partial<Filters> = {}) => {
    const nextFilters = { ...filters, ...patch };
    if (next !== view) window.history.pushState(null, "", locationFor(next, nextFilters));
    setFilters(nextFilters); setView(next); setMenuOpen(false);
    window.scrollTo({ top: 0 });
    setTimeout(() => document.querySelector<HTMLElement>("main h1")?.focus(), 0);
  };
  const setPairs = (pairs: [string, ToolId][], add: boolean) => setSelection(current => {
    const next = { ...current };
    pairs.forEach(([id, toolId]) => {
      const old = next[id] ?? [];
      const tools = add ? [...new Set([...old, toolId])] : old.filter(t => t !== toolId);
      if (tools.length) next[id] = tools; else delete next[id];
    });
    return next;
  });
  const toggle = (record: TeacherToolRecord) => setPairs([[record.professor.id, record.tool.id]], !selection[record.professor.id]?.includes(record.tool.id));
  const selectMany = (records: TeacherToolRecord[], add: boolean) => setPairs(records.map(r => [r.professor.id, r.tool.id]), add);
  const download = () => {
    const name = TEXTS.csvName(filters.period);
    const blob = new Blob([exportSelectionCsv(selection, filters.period)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(`Listo: se descargó «${name}» con ${plural(Object.keys(selection).length, "profesor", "profesores")}, una fila por persona. No se envió ninguna invitación.`);
  };
  const openGuide = (section?: GuideSection) => { setGuideSection(section); setDialog("method"); setMenuOpen(false); };
  const props: PageProps = { filters, onFilters, onNavigate, onProfessor: setProfessor, onMethod: openGuide };
  const selectedCount = Object.keys(selection).length;
  const currentIds = new Set(getRecords(view === "profesores" ? listFilters(filters) : { period: filters.period, faculty: filters.faculty, tool: filters.tool }).map(r => r.professor.id));
  const outside = Object.keys(selection).filter(id => !currentIds.has(id)).length;
  const taughtHere = getRecords({ period: filters.period, faculty: filters.faculty, tool: filters.tool }).length;
  const facultyCounts = useMemo(() => new Map(FACULTIES.map(f => [f, getRecords({ period: filters.period, faculty: f, tool: filters.tool }).length])), [filters.period, filters.tool]);
  const faculties = [...FACULTIES].sort((a, b) => facultyLong(a).localeCompare(facultyLong(b), "es"));
  const period = formatPeriod(filters.period);
  const forecastNote = TARGET && tool.forecast !== false && !offOrigin(filters.period) ? ` · Pronóstico para ${formatPeriod(TARGET)}` : "";

  return <div className="app-shell">
    <a className="skip-link" href="#contenido">Ir al contenido</a>
    {menuOpen && <button className="mobile-overlay" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Navegación principal">
      <a href="?vista=resumen" className="brand" onClick={event => { event.preventDefault(); onNavigate("resumen"); }}>
        <span className="brand-symbol" aria-hidden="true"><span/><span/><span/><span/></span><span className="brand-text">Conecta<span>—</span>TE<small className="brand-subtitle">Universidad de los Andes</small></span>
      </a>
      <div className="sidebar-label">Adopción y acompañamiento</div>
      <nav className="nav-list">{NAV.map(item => <button key={item.id} className="nav-item" aria-current={view === item.id ? "page" : undefined} onClick={() => onNavigate(item.id)}><Icon name={item.icon}/><span>{item.name}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Icon name="leaf" size={25}/><p>Los datos abren<br/><strong>conversaciones.</strong></p><span>El acompañamiento<br/>lo decides tú.</span></div><button className="text-link" onClick={() => openGuide()}><Icon name="info" size={16}/> Guía del tablero</button><div className="sidebar-signature">DIDACTA <span>·</span> Conecta-TE</div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><button className="button button-icon mobile-menu" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu"/></button><span>Estrategias de adopción</span><Icon name="chevron" size={13}/><strong>{activeView.name}</strong></div><div className="topbar-actions"><span className="demo-badge"><span/> {TEXTS.badge}</span><button className="button button-secondary change-file" aria-label="Cambiar archivo" onClick={onChangeFile}><Icon name="upload" size={16}/><span>Cambiar archivo</span></button><button className="selection-button" onClick={() => setDialog("selection")}><Icon name="users" size={17}/><span>Convocatoria ({number(selectedCount)})</span></button></div></header>
      <main id="contenido" className="workspace">
        <div className="global-filters">
          <span className="global-filters-label"><Icon name="calendar" size={16}/> Qué estás mirando</span>
          <label className="field tool-field"><span className="field-label">Herramienta</span><select aria-label="Herramienta" value={filters.tool} onChange={e => onFilters(toolPatch(e.target.value))}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}{isConfigOnly(t) ? " · solo configuración" : ""}</option>)}</select></label>
          <label className="field"><span className="field-label">Semestre</span><select aria-label="Semestre" value={filters.period} onChange={e => onFilters({ period: e.target.value as Filters["period"] })}>{[...SELECTABLE_PERIODS].reverse().map(p => <option key={p} value={p}>{formatPeriod(p)}</option>)}</select></label>
          <label className="field faculty-field"><span className="field-label">Facultad</span><select aria-label="Facultad" value={filters.faculty} onChange={e => onFilters({ faculty: e.target.value })}><option value="Todos">Todas las facultades</option>{faculties.map(f => <option key={f} value={f}>{facultyLong(f)}{facultyCounts.get(f) ? "" : ` · sin profesores en ${period}`}</option>)}</select></label>
          <span className="global-filters-note">Datos al cierre de {period}{forecastNote}</span>
          <div className="workshop-line"><p>Taller sugerido: <strong>{tool.workshop}</strong>{workshopNote(tool) && <span className="muted"> · {workshopNote(tool).replace(/^S/, "s").replace(/\.$/, "")}</span>}</p>
            <details className="context-help"><summary>¿Configurada o usada? Más sobre estos datos</summary><p>Datos al cierre de {period}{forecastNote}.{isConfigOnly(tool) ? ` De ${tool.name} solo sabemos si está configurada.` : ""} {CONFIG_HELP}</p></details></div>
        </div>
        {taughtHere === 0 ? <div className="callout"><Icon name="info"/><p>{filters.faculty === "Todos" ? "Ningún profesor" : `Ningún profesor de ${facultyLong(filters.faculty)}`} dictó en {period}. Elige otro semestre u otra facultad.</p></div>
          : taughtHere < MIN_PROFESSORS && <div className="callout"><Icon name="info"/><p>{facultyText(filters.faculty)} tiene {plural(taughtHere, "profesor", "profesores")} en {period}. Con menos de {MIN_PROFESSORS} profesores mostramos cantidades y no porcentajes, porque con tan pocas personas un porcentaje cambia mucho por una sola.</p></div>}
        <div key={view} className="page-content">
          {view === "resumen" && <SummaryPage {...props}/>}
          {view === "herramientas" && <ToolsPage {...props}/>}
          {view === "profesores" && <ProfessorsPage {...props} selection={selection} onToggle={toggle} onSelectMany={selectMany} onSelection={() => setDialog("selection")}/>}
          {view === "grupos" && <GroupsPage {...props}/>}
          {view === "predicciones" && <PredictionsPage {...props}/>}
        </div>
        <footer className="app-footer"><span>Conecta-TE <span aria-hidden="true">↗</span> Una mirada para acompañar</span><span>{DATA_SOURCE} <span>·</span> {period}</span></footer>
      </main>
    </div>
    {dialog === "method" && <MethodDialog section={guideSection} tool={tool} onClose={() => setDialog(null)}/>}
    {professor && <ProfessorDialog record={professor} currentTool={tool} selection={selection} onToggle={toggle} onClose={() => setProfessor(null)}/>}
    {dialog === "selection" && <SelectionDialog selection={selection} period={filters.period} outside={outside} downloaded={downloaded} onRemovePerson={id => setSelection(current => { const next = { ...current }; delete next[id]; return next; })} onRemovePair={(id, toolId) => setPairs([[id, toolId]], false)} onClear={() => setSelection({})} onExport={download} onGoList={() => { setDialog(null); setDownloaded(""); onNavigate("profesores"); }} onClose={() => { setDialog(null); setDownloaded(""); }}/>}
  </div>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: ReactNode; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1 tabIndex={-1}>{title}</h1><p className="page-description">{description}</p></div>{action && <div className="heading-actions">{action}</div>}</div>;
}

function ConfigurationShare({ tool, period, faculty }: { tool: Tool; period: PeriodId; faculty: string }) {
  // N = professors who taught with a known value: an unavailable external tool is unknown, not zero.
  const rows = SELECTABLE_PERIODS.filter(p => p <= period).map(p => {
    const taught = getRecords({ period: p, faculty, tool: tool.id });
    const known = taught.filter(r => r.observation.configured !== null);
    const configured = known.filter(r => r.observation.configured).length;
    return { period: p, configured, known: known.length, taught: taught.length, part: share(configured, known.length) };
  });
  return <div className="bar-list"><p className="small muted">Configurada en al menos un aula: es configuración, no uso con estudiantes. {COUNTED[tool.id] ?? ""} {tool.name} no recibe estado.</p>{rows.map(row => <div className="bar-row" key={row.period}><span className="bar-label">{formatPeriod(row.period)}</span><span className="bar-track"><span className="bar-fill" style={{ "--bar-width": `${(row.part.ratio ?? 0) * 100}%` } as CSSProperties}/></span><span className="bar-value">{row.part.ratio === null && row.known ? number(row.configured) : row.part.text}<span>{!row.known ? row.taught ? "sin dato" : "nadie dictó" : `${number(row.configured)} de ${number(row.known)}`}</span></span></div>)}<p className="bar-detail">Cada porcentaje: profesores con {tool.name} configurada en al menos un aula, entre los que dictaron ese semestre y tienen dato de configuración.{rows.some(row => row.taught > row.known) && " Sin dato: la herramienta no estaba activada para esos profesores ese semestre."}{rows.some(row => !row.taught) && " Nadie dictó: ningún profesor de este contexto dictó ese semestre."}{rows.some(row => row.known && row.part.ratio === null) && ` ${fewNote}`}</p></div>;
}

function SummaryPage({ filters, onFilters, onNavigate, onMethod }: PageProps) {
  const [reviewState, setReviewState] = useState<AdoptionState>("Adopta");
  const [mode, setMode] = useState<"rate" | "count">("rate");
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const configOnly = isConfigOnly(tool);
  const period = formatPeriod(filters.period);
  const base = { period: filters.period, faculty: filters.faculty };
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
  const unclassified = (condition: Condition) => all.filter(r => r.condition === condition).length;
  const fewProfessors = records.length < MIN_PROFESSORS;
  const onlyUse = USE_TOOLS.length < TOOLS.length;
  const adopting = records.filter(r => r.state === "Adopta").length;
  const neverUsed = records.filter(r => r.state === "No expuesto").length;
  const firstTime = records.filter(r => r.state === "Adopta" && r.taughtSemesters === 1).length;
  // First uses are compared with those who could start: No expuesto or Adopta (decision #6b).
  const couldStart = adopting + neverUsed;
  const started = share(adopting, couldStart);
  const abandoning = records.filter(r => r.state === "Abandona").length;
  const justLeft = records.filter(leftNow).length;
  const { configured, measurable } = summarize(records);
  const configuredPart = share(configured, measurable);
  const origin = TEXTS.forecastOrigin;
  const forecastHere = tool.forecast !== false && !offOrigin(filters.period);
  const withProbability = records.filter(r => r.probability !== null);
  const high = withProbability.filter(r => probabilityBandFor(r.tool.id, r.probability!) === "Alta").length;
  const sorted = [...rows].sort((a, b) => mode === "rate" ? (b.evaluated ? b.count / b.evaluated : 0) - (a.evaluated ? a.count / a.evaluated : 0) : b.count - a.count);
  const open = (patch: Partial<Filters>) => onNavigate("profesores", { ...listPatch, ...patch });
  const kicker = ["DEL DATO A LA CONVERSACIÓN", tool.name, period, facultyText(filters.faculty)].join(" · ").toLocaleUpperCase("es");
  return <>
    <div className="hero-grid"><div className="hero-copy"><p className="eyebrow">01 / RESUMEN</p><h1 tabIndex={-1}>Cada profesor,<br/>un siguiente paso.</h1><p className="page-description">Elige arriba una herramienta: cada una tiene su taller. Aquí ves cómo está en {period} y desde aquí abres la lista de profesores para su taller.</p><p className="page-description">Entiende cómo se incorporan las herramientas y encuentra dónde ofrecer acompañamiento.</p>
      <div className="steps"><strong>Cómo armar una convocatoria:</strong><ol><li>Elige la herramienta arriba: cada una tiene su taller.</li><li>En «Elegir profesores», marca a quién quieres en la lista del taller.</li><li>Abre «Convocatoria», revisa y descarga la lista.</li></ol></div>
      <button className="text-link" onClick={() => onMethod("estados")}>Guía: qué significa cada estado <Icon name="arrow" size={16}/></button></div>
      <div className="hero-card"><span className="hero-card-kicker"><Icon name="spark" size={17}/> {kicker}</span>
        {configOnly ? <><h2>{tool.name}: sabemos quién la tiene configurada.</h2><p>{measurable ? `${number(configured)} de ${number(measurable)} profesores con dato la tienen configurada en al menos un aula en ${period}${configuredPart.ratio === null ? "" : ` (${configuredPart.text})`}. ` : records.length ? "Este semestre no hay dato de configuración: la herramienta no estaba activada. " : "Ningún profesor de este contexto dictó este semestre. "}De {tool.name} solo sabemos si está configurada, no si sus estudiantes la usan, así que no recibe estado (Adopta, Usa…).</p><p className="hero-workshop">Taller sugerido: {tool.workshop}</p>{measurable > configured && <button className="button button-primary" onClick={() => open({ configured: "no" })}>Ver a los {number(measurable - configured)} que no la tienen configurada <Icon name="arrow" size={17}/></button>}</>
          : <><h2>Una primera experiencia<br/>puede ir más lejos.</h2><p>{records.length ? <>En {period}, {plural(adopting, "profesor usó", "profesores usaron")} {tool.name} con sus estudiantes por primera vez desde {SINCE} (estado Adopta).{firstTime ? ` ${firstTime === 1 ? "1 de ellos dicta" : `${number(firstTime)} de ellos dictan`} por primera vez en los datos (desde ${SINCE}).` : ""} Acompañarlos puede ayudar a que sigan usándola.</> : `Ningún profesor de este contexto dictó en ${period}: no hay a quién mostrar.`}</p><p className="hero-workshop">Taller sugerido: {tool.workshop}</p><button className="button button-primary" disabled={!adopting} onClick={() => open({ state: "Adopta" })}>{!adopting ? `Nadie empezó en ${period}` : adopting === 1 ? "Ver a esta persona" : `Ver a los ${number(adopting)} y elegir`} <Icon name="arrow" size={17}/></button>{neverUsed > 0 && <button className="text-link hero-link" onClick={() => open({ state: "No expuesto" })}>O ver a {neverUsed === 1 ? "la persona que no la ha usado" : `los ${number(neverUsed)} que no la han usado`} con estudiantes desde {SINCE} <Icon name="arrow" size={15}/></button>}</>}
        <button className="text-link hero-link" onClick={() => onNavigate("herramientas")}>Ver cómo está {tool.name} y su taller <Icon name="arrow" size={15}/></button><div className="hero-orbit" aria-hidden="true"/></div></div>
    <div className="metrics-grid">
      <Metric label={`Profesores que dictaron en ${period}`} value={number(records.length)} detail={`${facultyText(filters.faculty)} · cada persona cuenta una vez, aunque dicte varios cursos`} icon="users"/>
      {configOnly ? <Metric label={`${tool.name} configurada en ${period}`} value={configuredPart.ratio === null && measurable ? `${number(configured)} de ${number(measurable)}` : configuredPart.text} detail={`${configuredPart.ratio === null ? measurable ? "Pocos profesores, sin porcentaje" : "Sin profesores con dato de configuración" : `${number(configured)} de ${number(measurable)} profesores con dato la tienen en al menos un aula`} · configuración, no uso con estudiantes`} icon="leaf"/>
        : <Metric label={`Empezaron a usar ${tool.name} en ${period}`} value={plural(adopting, "profesor", "profesores")} detail={started.ratio === null ? couldStart ? `${number(adopting)} de ${number(couldStart)} que no la habían usado con estudiantes antes de ${period} · pocos profesores, sin porcentaje` : "Nadie que aún no la usara" : <>Son el {started.text} de los {number(couldStart)} que no la habían usado con estudiantes antes de {period}.<br/>Esos {number(couldStart)}: {number(adopting)} en Adopta y {number(neverUsed)} en No expuesto.</>} icon="leaf"/>}
      <Metric label={`Con probabilidad alta de configurar ${tool.name} ${nextTerm}`} value={forecastHere ? number(high) : "—"} detail={tool.forecast === false ? `No hay pronóstico para ${tool.name}` : !forecastHere && origin ? <>El pronóstico solo existe con datos de {formatPeriod(origin)}. <button className="text-link" onClick={() => onFilters({ period: origin })}>Ver {formatPeriod(origin)}</button></> : !withProbability.length ? "Nadie con probabilidad calculada en este contexto" : <>{bandText(tool.id, "Alta")} · de {number(withProbability.length)} con probabilidad calculada. <button className="text-link" onClick={() => open({ probability: "Alta" })}>Ver la lista</button></>} icon="trend"/>
    </div>
    <section className="panel"><SectionHeading eyebrow="COMPARAR HERRAMIENTAS" title="¿En qué herramienta hay más profesores en cada estado?" description={`Elige un estado. Cada barra dice qué parte de los profesores clasificados en esa herramienta está en ese estado (${period}).`} action={<div className="segmented" aria-label="Medida de comparación"><button data-active={mode === "rate"} aria-pressed={mode === "rate"} onClick={() => setMode("rate")}>Porcentaje</button><button data-active={mode === "count"} aria-pressed={mode === "count"} onClick={() => setMode("count")}>Cantidad</button></div>}/><div className="panel-body"><div className="state-selector" aria-label="Estado a comparar">{STATES.map(state => <button key={state} className="state-filter" data-active={reviewState === state} aria-pressed={reviewState === state} onClick={() => setReviewState(state)}><span className="state-dot" data-state={state}/><span>{state}<small>{STATE_SHORT[state]}</small></span></button>)}</div><p className="small muted chart-caption">{STATE_PLAIN[reviewState]} Qué conversar: {GUIDANCE[reviewState]} (sugerencia inicial). Toca una barra para ver a esos profesores.</p><div className="bar-list tool-comparison">{sorted.map(row => <button className="bar-row" key={row.tool.id} data-mine={row.tool.id === filters.tool || undefined} onClick={() => open({ tool: row.tool.id, state: reviewState })} aria-label={`${row.tool.name}: ${number(row.count)} de ${number(row.evaluated)} en ${reviewState}. Ver profesores`}><span className="bar-label">{row.tool.name}{row.tool.id === filters.tool && <small> · tu herramienta</small>}</span><span className="bar-track"><span className="bar-fill" data-state={reviewState} style={{ "--bar-width": `${mode === "rate" ? (row.part.ratio ?? 0) * 100 : records.length ? row.count / records.length * 100 : 0}%` } as CSSProperties}/></span><span className="bar-value">{mode === "rate" && row.part.ratio !== null ? row.part.text : number(row.count)}<span>{mode === "rate" ? `${number(row.count)} de ${number(row.evaluated)}` : `de ${number(row.evaluated)}${row.part.ratio !== null ? ` (${row.part.text})` : ""}`}</span></span><Icon name="arrowUp" size={16}/></button>)}</div><p className="bar-detail">Cada porcentaje se calcula sobre los profesores clasificados (con uno de los 5 estados) en esa herramienta; por eso la base cambia de una barra a otra. Quienes no tienen estado («{CASE_LABELS.regla}» o «{CASE_LABELS.dato}») no entran en el porcentaje y se cuentan en «¿A cuántos les pudimos dar un estado?», al final de esta página.{onlyUse && ` Solo aparecen las ${USE_TOOLS.length} herramientas con datos de uso con estudiantes; las otras ${TOOLS.length - USE_TOOLS.length} solo tienen datos de configuración y no reciben estado.`}{configOnly && ` Por eso ${tool.name} no aparece aquí.`}{!configOnly && reviewState === "Adopta" && started.ratio !== null && ` Arriba, Adopta en ${tool.name} es el ${started.text} porque allá la base son solo los ${number(couldStart)} que no la habían usado antes de ${period}.`}{mode === "count" && ` En «Cantidad», el largo de la barra se compara con los ${number(records.length)} profesores que dictaron en ${period}.`}{mode === "rate" && rows.some(row => row.evaluated && row.part.ratio === null) && ` ${fewNote}`}</p></div></section>
    {!configOnly && <aside className="panel accompaniment-note is-wide"><div className="panel-body"><span className="note-icon"><Icon name="clock" size={24}/></span><p className="eyebrow">TAMBIÉN MERECE UNA CONVERSACIÓN</p><h2>Volver a mirar<br/>una interrupción.</h2><p>{plural(abandoning, "profesor dejó", "profesores dejaron")} de usar {tool.name} con sus estudiantes después de usarla 2 o más semestres seguidos (estado Abandona): {number(justLeft)} la {justLeft === 1 ? "dejó" : "dejaron"} en {period} y {number(abandoning - justLeft)} antes. No quiere decir que la {abandoning === 1 ? "dejó" : "dejaron"} para siempre. El dato invita a preguntar qué cambió.</p><button className="button button-secondary" disabled={!abandoning} onClick={() => open({ state: "Abandona" })}>{abandoning === 1 ? "Ver a esta persona" : `Ver a los ${number(abandoning)}`} <Icon name="arrow" size={16}/></button></div></aside>}
    <details className="panel coverage"><summary className="panel-header">Ver detalle: ¿a cuántos les pudimos dar un estado? {fewProfessors ? `${number(evaluated)} de ${number(all.length)} casos` : `${share(evaluated, all.length).text} (${number(evaluated)} de ${number(all.length)} casos)`} en {period}</summary><div className="panel-body"><p>En {period}, cada profesor cuenta una vez por herramienta: {number(records.length)} profesores × {USE_TOOLS.length} herramientas con datos de uso con estudiantes = {number(all.length)} casos. {number(evaluated)} tienen uno de los 5 estados{fewProfessors ? " · pocos profesores, sin porcentaje" : ` (${share(evaluated, all.length).text})`}.</p><p>Los otros {number(all.length - evaluated)} no tienen estado: {number(unclassified("regla"))} «{CASE_LABELS.regla}» (la usaron sin llegar a 2 semestres seguidos, o la retomaron: el dato existe, pero el marco todavía no tiene una regla para ellos) y {number(unclassified("dato"))} «{CASE_LABELS.dato}».{onlyUse && ` Las ${TOOLS.length - USE_TOOLS.length} herramientas que solo tienen datos de configuración no entran en esta cuenta.`}</p><button className="text-link" onClick={() => onMethod("estados")}>Por qué hay casos sin estado <Icon name="arrow" size={15}/></button></div></details>
  </>;
}

function ToolsPage({ filters, onFilters, onNavigate, onProfessor, onMethod }: PageProps) {
  const [tab, setTab] = useState<"observado" | "previsto">("observado");
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const configOnly = isConfigOnly(tool);
  const period = formatPeriod(filters.period);
  const [ruleTitle, rule] = TEXTS.toolRule(tool);
  const records = getRecords({ period: filters.period, faculty: filters.faculty, tool: filters.tool });
  const { states, configured, measurable } = summarize(records);
  const [trendState, setTrendState] = useState<AdoptionState>("Usa");
  const periods = SELECTABLE_PERIODS.filter(p => p <= filters.period);
  const trends = periods.map(period => { const rows = getRecords({ period, faculty: filters.faculty, tool: filters.tool }); return { period, count: rows.filter(r => r.state === trendState).length, n: rows.filter(r => r.state !== "Sin información").length }; });
  // Configuration-only tools have no Adopta or Abandona, so their examples are those with it configured.
  const examples = (configOnly ? records.filter(r => r.observation.configured) : records.filter(r => r.state === "Adopta" || r.state === "Abandona")).sort(byCode);
  const eligible = records.filter(r => r.probability !== null);
  const top = [...eligible].sort(byProbability).slice(0, 6);
  const rate = habitualRate(tool.id);
  const open = (patch: Partial<Filters>) => onNavigate("profesores", { ...listPatch, ...patch });
  return <><PageHeading eyebrow="02 / TALLERES Y HERRAMIENTAS" title="El uso tiene distintos momentos." description="Explora una herramienta y reconoce qué acompañamiento puede tener sentido." action={<button className="button button-secondary" onClick={() => onMethod("estados")}><Icon name="info" size={17}/> Guía: los estados</button>}/>
    <div className="tool-tabs" aria-label="Herramientas">{TOOLS.map(t => <button className="tool-tab" key={t.id} data-active={t.id === filters.tool} aria-pressed={t.id === filters.tool} onClick={() => onFilters(toolPatch(t.id))}>{t.name}{isConfigOnly(t) && <small>solo configuración</small>}</button>)}</div>
    <p className="small muted tool-tabs-note">Solo configuración: de estas herramientas solo sabemos si están configuradas, no si los estudiantes las usan; por eso no tienen estado.</p>
    <div className="tool-heading"><div><p className="eyebrow">HERRAMIENTA Y SU TALLER</p><h2>{tool.name}</h2><p className="muted">{tool.description}</p><p className="workshop-name">Taller sugerido: <strong>{tool.workshop}</strong></p>{workshopNote(tool) && <p className="small muted">{workshopNote(tool)}</p>}<button className="button button-primary" onClick={() => open({})}>Armar la lista de este taller <Icon name="arrow" size={16}/></button></div><div className="segmented" aria-label="Tipo de información"><button data-active={tab === "observado"} aria-pressed={tab === "observado"} onClick={() => setTab("observado")}>Lo observado ({period})</button><button data-active={tab === "previsto"} aria-pressed={tab === "previsto"} onClick={() => setTab("previsto")}>Lo previsto{TARGET ? ` (${formatPeriod(TARGET)})` : ""}</button></div></div>
    {tab === "observado" ? <>{configOnly ? <section className="panel"><SectionHeading title={`¿Quiénes la tienen configurada? ${tool.name} por semestre, hasta ${period}`}/><div className="panel-body"><ConfigurationShare tool={tool} period={filters.period} faculty={filters.faculty}/><div className="heading-links">{measurable > configured && <button className="button button-secondary" onClick={() => open({ configured: "no" })}>Ver a los {number(measurable - configured)} que no la tienen configurada en {period}</button>}{configured > 0 && <button className="text-link" onClick={() => open({ configured: "si" })}>Ver a los {number(configured)} que la tienen <Icon name="arrow" size={15}/></button>}</div></div></section>
      : <div className="two-column"><section className="panel"><SectionHeading title={`Estado de cada profesor en ${tool.name}, ${period}`} description="La adopción se observa por herramienta, no como una nota del profesor."/><div className="panel-body"><StateBars records={records} onSelect={state => open({ state })}/>{states["Sin información"] > 0 && <button className="text-link" onClick={() => open({ state: "Sin información" })}>Ver a los {number(states["Sin información"])} sin estado <Icon name="arrow" size={15}/></button>}<p className="small muted">Qué conversar: sugerencia inicial según el estado, igual para todos en el mismo estado; pendiente de aprobación de Conecta-TE.</p></div></section>
        <section className="panel"><SectionHeading title={`¿Cómo ha cambiado? Profesores en ${trendState} por semestre`} description="La misma definición, aplicada a cada semestre."/><div className="panel-body"><label className="field trend-field"><span className="field-label">Ver la evolución de</span><select aria-label="Ver la evolución de" value={trendState} onChange={e => setTrendState(e.target.value as AdoptionState)}>{STATES.map(s => <option key={s} value={s}>{s} · {STATE_SHORT[s]}</option>)}</select></label><div className="trend-bars">{trends.map(row => { const part = share(row.count, row.n); return <button key={row.period} className="trend-column" aria-label={`${formatPeriod(row.period)}: ${number(row.count)} de ${number(row.n)} en ${trendState}${part.ratio === null ? "" : ` (${part.text})`}. Ver la lista de ese semestre`} onClick={() => onNavigate("profesores", { ...listPatch, period: row.period, state: trendState })}><span className="trend-number">{part.ratio === null ? number(row.count) : part.text}</span><span className="trend-track"><span data-state={trendState} className="bar-fill" style={{ height: `${(part.ratio ?? 0) * 100}%` }}/></span><span className="trend-label">{formatPeriod(row.period)}</span><span className="small muted">{number(row.count)} de {number(row.n)}</span></button>; })}</div><p className="bar-detail">La altura es el porcentaje de profesores clasificados (con uno de los 5 estados) en cada semestre; la base cambia de un semestre a otro. Tocar una columna abre la lista de ese semestre y cambia el semestre de arriba.{trends.some(row => row.n && row.n < MIN_PROFESSORS) && ` ${fewNote}`}</p></div></section></div>}
      <section className="panel"><SectionHeading title={configOnly ? `Ejemplos: profesores con ${tool.name} configurada` : "Ejemplos: profesores en Adopta o Abandona"} description={`Los 5 primeros por código, no por prioridad.${configOnly ? "" : " La conversación empieza por una persona."}`} action={<div className="heading-links">{!configOnly && states.Adopta > 0 && <button className="text-link" onClick={() => open({ state: "Adopta" })}>Ver a los {number(states.Adopta)} en Adopta</button>}{!configOnly && states.Abandona > 0 && <button className="text-link" onClick={() => open({ state: "Abandona" })}>Ver a los {number(states.Abandona)} en Abandona</button>}<button className="text-link" onClick={() => open({})}>Ver la lista completa <Icon name="arrow" size={16}/></button></div>}/><RecordTable records={examples.slice(0, 5)} onProfessor={onProfessor}/></section>
      <div className="callout"><Icon name="info"/><div><strong>{configOnly ? ruleTitle : "Cómo se decide el estado (reglas provisionales)"}</strong>{configOnly ? <p>{rule}</p> : <><ul>{TEXTS.plainRules(tool).map(text => <li key={text}>{text}</li>)}</ul><details><summary>Ver detalle técnico</summary><p>{rule}</p></details></>}</div></div></>
      : <><div className="callout"><Icon name="trend"/><p><strong>Este pronóstico dice qué tan probable es que el profesor configure {tool.name} en al menos un aula {nextTerm}, si vuelve a dictar.</strong> No dice si sus estudiantes la usarán, en qué estado quedará (Adopta, Usa, Apropia o Abandona) ni si el taller le servirá.</p></div>
        <div className="panel">{tool.forecast === false ? <EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no se calculó la probabilidad de configurarla. Para armar su lista, usa la de quienes no la tienen configurada.`} action={<button className="button button-secondary" onClick={() => open({ configured: "no" })}>Ver a quienes no la tienen configurada</button>}/> : offOrigin(filters.period) ? <OffOrigin period={filters.period} onGo={period => onFilters({ period })}/> : <>
          <SectionHeading title={`¿Quién podría configurar ${tool.name} ${nextTerm}?`} description={`Los ${top.length} con mayor probabilidad, de ${plural(eligible.length, "profesor", "profesores")} con probabilidad calculada. Se calculó con los datos de ${period}, solo para quienes no la tenían configurada en ${period}; incluye a quienes la tuvieron antes y la dejaron.${rate === null ? "" : ` Lo habitual es ${formatProbability(rate)}.`}`} action={<div className="heading-links">{eligible.length > 0 && <button className="button button-secondary" onClick={() => open({ probability: "Con estimación" })}>Ver a los {number(eligible.length)} en orden de probabilidad</button>}<button className="text-link" onClick={() => onNavigate("predicciones")}>Ver el pronóstico completo <Icon name="arrow" size={16}/></button></div>}/>
          <RecordTable records={top} onProfessor={onProfessor} showProbability antecedent/>
          <ul className="table-notes">{!configOnly && <li>Configurar no es usar: alguien en No expuesto puede haber tenido {tool.name} configurada antes sin que sus estudiantes la usaran.</li>}<li>Haberla configurado antes va junto con una probabilidad más alta; es una relación en los datos, no quiere decir que el taller le sirva más.</li><li>La probabilidad no mide el beneficio del taller ni el mérito del profesor.</li><li>Vale si vuelve a dictar.{rate === null ? "" : ` La marca fina en cada barra es lo habitual (${formatProbability(rate)}).`}</li></ul></>}</div></>}
  </>;
}

/** `antecedent` swaps the guidance column for the configuration background that comes with each forecast. */
function RecordTable({ records, onProfessor, selection, onToggle, onSelectMany, showProbability = false, antecedent = false, showGroup = false }: { records: TeacherToolRecord[]; onProfessor: (record: TeacherToolRecord) => void; selection?: Selection; onToggle?: (record: TeacherToolRecord) => void; onSelectMany?: (records: TeacherToolRecord[], add: boolean) => void; showProbability?: boolean; antecedent?: boolean; showGroup?: boolean }) {
  const allChecked = records.length > 0 && records.every(r => selection?.[r.professor.id]?.includes(r.tool.id));
  const someChecked = records.some(r => selection?.[r.professor.id]?.includes(r.tool.id));
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = someChecked && !allChecked; }, [someChecked, allChecked]);
  if (!records.length) return <EmptyState title="No hay profesores con estos criterios" description="Prueba otro estado, herramienta o facultad para continuar la consulta."/>;
  const tool = records[0].tool;
  const period = formatPeriod(records[0].period);
  const habitual = habitualRate(tool.id);
  // Configuration-only tools get no guidance (decision #13); every row is the same tool.
  const guided = !antecedent && !isConfigOnly(tool);
  const stateHeader = isConfigOnly(tool) ? `¿La tiene configurada? (${period})` : `Estado en ${tool.name} (${period})`;
  const probabilityHeader = `Probabilidad de configurarla ${nextTerm}`;
  const groupHeader = "Grupo en su semestre anterior";
  return <div className="table-wrap"><table className="data-table as-cards"><thead><tr>{selection && <th className="checkbox-cell"><label className="select-page"><input ref={checkbox} type="checkbox" aria-label={`Seleccionar a los ${records.length} de esta página para el taller de ${tool.name}`} checked={allChecked} onChange={e => onSelectMany?.(records, e.target.checked)}/><span className="select-page-text" aria-hidden="true">Marcar a los {number(records.length)} de esta página</span></label></th>}<th>Profesor</th><th>{stateHeader}</th>{showProbability && <th>{probabilityHeader}<span className="th-note">Si vuelve a dictar{habitual === null ? "" : ` · marca fina: lo habitual (${formatProbability(habitual)})`}</span></th>}{antecedent && <th>¿La ha tenido antes en sus aulas?</th>}{showGroup && <th>{groupHeader}<span className="th-note">Describe qué configuraba; no es un nivel</span></th>}{guided && <th>Qué conversar<span className="th-note">Sugerencia inicial, pendiente de aprobación</span></th>}<th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{records.map(record => { const group = GROUPS.find(g => g.id === record.originGroup); return <tr key={record.professor.id} data-selected={selection?.[record.professor.id]?.includes(record.tool.id) || undefined}>{selection && <td className="checkbox-cell"><input type="checkbox" aria-label={`Seleccionar a ${record.professor.name}`} checked={selection[record.professor.id]?.includes(record.tool.id) ?? false} onChange={() => onToggle?.(record)}/></td>}<td data-label="Profesor"><button className="person-cell person-button" onClick={() => onProfessor(record)}><PersonIcon initials={record.professor.initials}/><span><span className="person-name">{record.professor.name}</span><span className="person-meta">{facultyLong(record.faculty)}</span></span></button></td><td data-label={stateHeader}><StateBadge state={record.state} label={badgeLabel(record)}/>{!isConfigOnly(tool) && <span className="state-note">{record.condition ? caseNote[record.condition] : STATE_SHORT[record.state]}</span>}</td>{showProbability && <td data-label={probabilityHeader}><Probability value={record.probability} missing={noForecast(record)} habitual={habitual}/>{record.probability !== null && antecedent && <span className="state-note">{bandText(tool.id, probabilityBandFor(tool.id, record.probability))}</span>}{!antecedent && record.forecastReason && <span className="state-note">{record.forecastReason}</span>}</td>}{antecedent && <td className="table-reason" data-label="¿La ha tenido antes en sus aulas?">{record.forecastReason ?? "—"}</td>}{showGroup && <td className="table-reason" data-label={groupHeader}>{group ? group.name : <>—<span className="state-note">Sin semestre anterior desde {SINCE}</span></>}</td>}{guided && <td className="table-reason" data-label="Qué conversar">{GUIDANCE[record.state]}</td>}<td><button className="button button-ghost table-open" aria-label={`Ver ficha de ${record.professor.name}`} onClick={() => onProfessor(record)}>Ver ficha<Icon name="arrowUp" size={15}/></button></td></tr>; })}</tbody></table></div>;
}

function ProfessorsPage(props: PageProps & { selection: Selection; onToggle: (record: TeacherToolRecord) => void; onSelectMany: (records: TeacherToolRecord[], add: boolean) => void; onSelection: () => void }) {
  const { filters, onFilters, selection, onToggle, onSelectMany, onProfessor, onSelection } = props;
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const configOnly = isConfigOnly(tool);
  const period = formatPeriod(filters.period);
  // Forecasts exist only at their origin and only for tools with a model (decision #15).
  const forecastHere = tool.forecast !== false && !offOrigin(filters.period);
  // Code order by default; arriving with a probability filter (such as from Pronóstico) lists by probability.
  const [sort, setSort] = useState<"code" | "probability">(filters.probability !== "Todas" ? "probability" : "code");
  const [stepsOpen] = useState(() => { try { return !localStorage.getItem(STEPS_KEY); } catch { return true; } });
  useEffect(() => { try { localStorage.setItem(STEPS_KEY, "1"); } catch { /* The steps open again next time. */ } }, []);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const records = getRecords(listFilters(filters));
  // Ties on the shown (rounded) probability go by code; rows without one go last, never as 0.
  const probabilityOrder = forecastHere && sort === "probability";
  const sorted = useMemo(() => [...records].sort(probabilityOrder ? byProbability : byCode), [records, probabilityOrder]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [filters, sort, pageSize]);
  const rate = habitualRate(tool.id);
  const validation = VALIDATION_ROWS.filter(row => row.toolId === tool.id);
  const validationPeriods = [...new Set(validation.map(row => formatPeriod(row.period)))].sort().join(" o ");
  const origin = TEXTS.forecastOrigin;
  const chosen = Object.keys(selection).length;
  const inTool = Object.values(selection).filter(tools => tools.includes(tool.id)).length;
  // Only this workshop's marks: someone marked for another workshop also shows in this list, unmarked.
  const chosenVisible = records.filter(r => selection[r.professor.id]?.includes(tool.id)).length;
  const reset = () => onFilters(listPatch);
  const clearProbability = <button className="button button-secondary" onClick={() => onFilters({ probability: "Todas" })}>Quitar el filtro de probabilidad</button>;
  const group = GROUPS.find(g => g.id === filters.group);
  const summary = [
    configOnly ? filters.configured === "Todos" ? `${tool.name}: todos` : `${tool.name} configurada: ${CONFIGURED_OPTIONS[filters.configured].toLocaleLowerCase("es")}` : filters.state === "Todos" ? "Todos los estados" : filters.state === "Sin información" ? "Sin estado" : filters.state,
    period,
    group && `grupo en su semestre anterior: ${group.name}`,
    filters.probability !== "Todas" && `probabilidad: ${filters.probability === "Con estimación" ? "con probabilidad calculada" : bandText(tool.id, filters.probability).toLocaleLowerCase("es")}`,
  ].filter(Boolean).join(" · ");
  return <><PageHeading eyebrow="03 / ELEGIR PROFESORES" title="El acompañamiento tiene nombre." description="Revisa la evidencia, elige a quién conversar y prepara una convocatoria." action={<button className="button button-primary" onClick={onSelection}><Icon name="users" size={17}/> Convocatoria ({number(chosen)})</button>}/>
    <div className="workshop-band"><Icon name="book"/><p>Estás armando la lista del taller <strong>«{tool.workshop}»</strong> ({tool.name}, {period}). Para otro taller, cambia la herramienta arriba.</p></div>
    <details className="steps-box" open={stepsOpen}><summary>Cómo armar la lista en 3 pasos</summary><p>1. {configOnly ? "Filtra por «¿La tiene configurada?» (por ejemplo, No)" : `Filtra por estado (por ejemplo, No expuesto: ${STATE_SHORT["No expuesto"]})`}{forecastHere ? " o por rango de probabilidad" : ""}. 2. Ordena por código{forecastHere ? " o por probabilidad" : ""}. 3. Marca a quién quieres (cada casilla lo agrega a la convocatoria de este taller) y abre «Convocatoria» para revisar y descargar.</p></details>
    <section className="panel"><div className="panel-body filters-grid"><label className="field search-field"><span className="field-label">Buscar profesor</span><span className="search-input"><Icon name="search" size={17}/><input type="search" aria-label="Buscar profesor" placeholder={TEXTS.searchPlaceholder} value={filters.search} onChange={e => onFilters({ search: e.target.value })}/></span></label>
      {configOnly ? <label className="field"><span className="field-label">¿La tiene configurada en {period}?</span><select aria-label={`¿La tiene configurada en ${period}?`} value={filters.configured} onChange={e => onFilters({ configured: e.target.value as Filters["configured"] })}><option value="Todos">Todos</option>{Object.entries(CONFIGURED_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small className="field-help">De {tool.name} solo sabemos si está configurada: no tiene estados (Adopta, Usa…).</small></label>
        : <label className="field"><span className="field-label">Estado en {tool.name} ({period})</span><select aria-label={`Estado en ${tool.name} (${period})`} value={filters.state} onChange={e => onFilters({ state: e.target.value as Filters["state"] })}><option value="Todos">Todos los estados</option>{STATES.map(s => <option key={s} value={s}>{s} · {STATE_SHORT[s]}</option>)}<option value="Sin información">Sin estado (probó y no siguió, la retomó o falta información)</option></select></label>}
      <label className="field"><span className="field-label">Grupo en su semestre anterior</span><select aria-label="Grupo en su semestre anterior" title={`El del último semestre que dictó antes de ${period}. Describe qué configuraba; no es un nivel.`} value={filters.group} onChange={e => onFilters({ group: e.target.value as Filters["group"] })}><option value="Todos">Todos los grupos</option>{GROUPS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      {forecastHere && <label className="field"><span className="field-label">Probabilidad de configurarla {nextTerm}</span><select aria-label={`Probabilidad de configurarla ${nextTerm}`} value={filters.probability} onChange={e => { const probability = e.target.value as Filters["probability"]; onFilters({ probability }); if (probability !== "Todas") setSort("probability"); }}><option value="Todas">Todos</option>{[...BANDS].reverse().map(band => <option key={band} value={band}>{bandText(tool.id, band)}</option>)}<option value="Con estimación">Con probabilidad calculada (cualquier rango)</option></select></label>}</div>
      <div className="panel-footer filter-secondary"><span className="small muted">{forecastHere ? TEXTS.relativeBands && rate !== null && `Lo habitual en ${tool.name}: ${formatProbability(rate)}. De ${number(validation.length)} veces en que un profesor no la tenía configurada (al llegar a ${validationPeriods}), en ${number(validation.filter(row => row.outcome).length)} la configuró.` : tool.forecast === false || !origin ? `Sin modelo para ${tool.name}: no hay probabilidad de configurarla.` : <>Solo hay probabilidad con datos de {formatPeriod(origin)}. <button className="text-link" onClick={() => onFilters({ period: origin })}>Ver {formatPeriod(origin)}</button></>}</span><button className="text-link" onClick={reset}>Limpiar filtros de la lista</button></div></section>
    <div className="list-context"><div><h2>{plural(records.length, "profesor", "profesores")} <span className="muted">· {tool.name}</span></h2><p className="small muted">{summary}{probabilityOrder ? " · ordenada por probabilidad de configurarla, no por necesidad ni por beneficio" : ""}</p></div><label className="field inline-field"><span className="field-label">Ordenar por</span><select aria-label="Ordenar por" value={probabilityOrder ? "probability" : "code"} onChange={e => setSort(e.target.value as "code" | "probability")}><option value="code">Código (A–Z, sin orden de prioridad)</option>{forecastHere && <option value="probability">Mayor probabilidad de configurarla primero</option>}</select></label></div>
    {forecastHere && <details className="callout callout-compact"><summary><Icon name="info"/><span>Antes de marcar: la probabilidad no mide si el taller le servirá ni el mérito del profesor. <span className="more">Ver más</span></span></summary><p>Solo dice qué tan probable es que configure la herramienta {nextTerm}, si vuelve a dictar. «Sin estimación» quiere decir que no se pudo calcular; no es 0&nbsp;%.</p></details>}
    <section className="panel">{filters.probability !== "Todas" && !forecastHere ? tool.forecast === false ? <EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no hay probabilidad de configurarla.`} action={clearProbability}/> : <OffOrigin period={filters.period} onGo={period => onFilters({ period })} extra={clearProbability}/> : <RecordTable records={visible} onProfessor={onProfessor} selection={selection} onToggle={onToggle} onSelectMany={onSelectMany} showProbability={forecastHere} showGroup/>}{records.length > 0 && <div className="pagination"><span>{number((currentPage - 1) * pageSize + 1)}–{number(Math.min(currentPage * pageSize, records.length))} de {plural(records.length, "profesor", "profesores")}</span><label className="field inline-field page-size"><span className="field-label">Filas por página</span><select aria-label="Filas por página" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>{[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}</select></label><div><button className="button button-secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior">Anterior</button><span>Página {number(currentPage)} de {number(pageCount)}</span><button className="button button-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Página siguiente">Siguiente</button></div></div>}</section>
    <ul className="table-notes">{probabilityOrder && <li>Con la misma probabilidad mostrada, el orden es por código.</li>}{forecastHere && <li>Probabilidad de configurarla {nextTerm}: vale si vuelve a dictar.{rate === null ? "" : ` La marca fina en cada barra es lo habitual en ${tool.name} (${formatProbability(rate)}).`}</li>}{!configOnly && <li>Configurar no es usar: alguien en No expuesto puede tener {tool.name} configurada sin que sus estudiantes la usen.</li>}<li>Grupo en su semestre anterior: el del último semestre que dictó antes de {period}. Describe qué configuraba; no es un nivel.</li>{!configOnly && <li>Qué conversar: sugerencia inicial según el estado, igual para todos en el mismo estado; pendiente de aprobación de Conecta-TE.</li>}</ul>
    {chosen > 0 && <div className="selection-tray"><div><Icon name="check"/><strong>{plural(chosen, "profesor", "profesores")} en la convocatoria<span className="tray-tool"> · {number(inTool)} en la lista de este taller</span></strong>{inTool > 0 && <span className="tray-detail">{number(chosenVisible)} {chosenVisible === 1 ? "se ve" : "se ven"} en esta lista · {number(inTool - chosenVisible)} {inTool - chosenVisible === 1 ? "no se ve" : "no se ven"} con los filtros actuales (siguen guardados)</span>}</div><button className="button button-primary" onClick={onSelection}>Convocatoria ({number(chosen)}) <Icon name="arrow" size={16}/></button></div>}
  </>;
}

function ProfessorDialog({ record, currentTool, selection, onToggle, onClose }: { record: TeacherToolRecord; currentTool: Tool; selection: Selection; onToggle: (record: TeacherToolRecord) => void; onClose: () => void }) {
  const [toolId, setToolId] = useState(record.tool.id);
  const row = toolId === record.tool.id ? record : getRecord(record.professor.id, toolId, record.period);
  const { tool } = row;
  const period = formatPeriod(row.period);
  const selected = selection[row.professor.id]?.includes(tool.id) ?? false;
  const typical = typicalIntensity(row);
  const nextGroups = nextGroupProbabilities(row.professor.id, row.period);
  const likely = nextGroups ? nextGroups.indexOf(Math.max(...nextGroups)) : -1;
  const configOnly = isConfigOnly(tool);
  const { effective, reach, configured, shared } = row.observation;
  const group = GROUPS.find(g => g.id === row.professor.groupByPeriod[row.period]);
  const previous = row.professor.periods.filter(p => p < row.period).at(-1);
  const origin = GROUPS.find(g => g.id === row.originGroup);
  return <Dialog title={row.professor.name} eyebrow={<>FICHA DEL PROFESOR · <span className="as-written">{row.professor.id}</span></>} onClose={onClose} wide footer={<><div className="footer-note"><span className="small muted">{TEXTS.identity}</span>{tool.id !== currentTool.id && <span className="small footer-warning">Ojo: estás viendo {tool.name}. El botón agrega a la convocatoria del taller de {tool.name}, no al de {currentTool.name}.</span>}</div><button className="button button-primary button-wrap" onClick={() => onToggle(row)}><Icon name={selected ? "check" : "plus"} size={17}/>{selected ? `Quitar de la convocatoria del taller «${tool.workshop}»` : `Agregar a la convocatoria del taller «${tool.workshop}»`}</button></>}>
    <div className="detail-profile"><span className="avatar avatar-large" aria-hidden="true">{row.professor.initials}</span><div><p>Facultad: {facultyLong(row.faculty)} · {row.professor.department}</p><p className="muted small">Grupo en {period}: {group?.name ?? "sin grupo"}</p><p className="muted small">{origin && previous ? `Grupo en su semestre anterior (${formatPeriod(previous)}): ${origin.name}` : `Grupo en su semestre anterior: no tiene (dicta por primera vez en los datos, desde ${SINCE})`}</p><p className="muted small">Los grupos describen qué configura cada profesor; no son un nivel ni una nota.</p></div></div>
    <div className="tool-chips"><span className="small muted">Su estado en las {TOOLS.length} herramientas ({period}):</span>{TOOLS.map(t => { const other = getRecord(row.professor.id, t.id, row.period); return <button key={t.id} className="tool-chip" aria-pressed={t.id === tool.id} onClick={() => setToolId(t.id)}>{isConfigOnly(t) ? `${t.name} configurada: ${configuredLabel(other.observation.configured)}` : `${t.name}: ${plainLabel(other)}`}</button>; })}</div>
    <div className="toolbar"><label className="field"><span className="field-label">Herramienta de la ficha</span><select aria-label="Herramienta de la ficha" value={toolId} onChange={e => setToolId(e.target.value as ToolId)}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
    <p className="state-headline">{configOnly ? <strong>{tool.name} configurada en {period}: {configuredLabel(configured)}</strong> : <>Estado en {tool.name} ({period}): <StateBadge state={row.state} label={plainLabel(row)}/>{!row.condition && <span className="muted"> {STATE_SHORT[row.state]}</span>}</>}</p>
    <p className="detail-reason">{plainReason(row)}</p>
    <details className="detail-disclosure"><summary>Ver la regla exacta</summary><p>{row.reason}{configOnly && COUNTED[tool.id] ? ` ${COUNTED[tool.id]}` : ""}</p></details>
    <div className="action-card"><span className="eyebrow">TALLER Y QUÉ CONVERSAR</span><h3>Taller sugerido: {tool.workshop}</h3>{!configOnly && <p>Qué conversar: <strong>{GUIDANCE[row.state]}</strong> (porque está en {plainLabel(row)})</p>}<p className="small muted">Sugerencia inicial, pendiente de aprobación de Conecta-TE. La pertinencia del taller se confirma con el profesor y su contexto de curso. Este tablero no estima el efecto del acompañamiento.</p></div>
    <h3 className="detail-section-title">Probabilidad de configurar {tool.name} {nextTerm}</h3>{tool.forecast === false ? <p className="small">Sin modelo para esta herramienta.</p> : offOrigin(row.period) ? <p className="small">Solo hay pronóstico con datos de {formatPeriod(TEXTS.forecastOrigin!)}. En {period} no hay pronóstico.</p> : <div className="detail-forecast"><Probability value={row.probability} missing={noForecast(row)} habitual={habitualRate(tool.id)}/>{row.probability !== null && <p className="small">{bandText(tool.id, probabilityBandFor(tool.id, row.probability))}{row.forecastReason ? ` · ${row.forecastReason}` : ""}</p>}<p className="small muted">Si vuelve a dictar. No mide si el taller le servirá ni el mérito del profesor.</p><details className="detail-disclosure"><summary>Más sobre este número</summary><p className="small muted">Es un pronóstico, no un estado: no dice si la usará con estudiantes, si llegará a Apropia ni si el taller le servirá.</p><p className="small muted">{TEXTS.estimate}</p></details></div>}
    <div className="evidence-grid"><div className="evidence-item"><span>¿Sus estudiantes la usaron en {period}?</span><strong>{configOnly ? "No aplica" : effective === null ? "Sin información" : effective ? "Sí" : "No"}</strong>{configOnly && <small>De {tool.name} solo sabemos si está configurada.</small>}{effective && reach !== null && <small>{formatProbability(reach)} de sus estudiantes de {period} tuvo actividad en {tool.name}. Para contar como uso basta 1 estudiante.</small>}</div><div className="evidence-item"><span>Semestres seguidos usándola</span><strong>{configOnly ? "No aplica" : row.condition === "dato" ? "Sin información" : number(row.sustainedPeriods)}</strong></div><div className="evidence-item"><span title="Valor típico = mediana del tramo activo">{configOnly ? `Contenido de ${tool.name} por aula` : `${TEXTS.unit.replace(/^./, c => c.toLocaleUpperCase("es"))} en ${tool.name} (valor típico)`}</span><strong>{typical === null ? "Sin dato" : number(typical)}</strong><small>{TEXTS.intensity(tool.threshold)}{typical !== null && " Valor típico = mediana de sus semestres seguidos de uso."}</small></div><div className="evidence-item"><span>¿La tiene configurada en {period}?</span><strong>{configured === null ? "Sin información" : configured ? "Sí, en al menos una de sus aulas" : "No"}</strong></div></div>
    {shared && <p className="small muted">Todas sus aulas de {period} son compartidas con otros docentes: la herramienta cuenta para cada docente del aula, aunque tal vez la configuró otra persona.</p>}
    <h3 className="detail-section-title">Su recorrido en {tool.name}</h3><p className="small muted">Un estado por semestre que dictó. Los semestres en que no dictó no aparecen.</p><div className="history-strip">{row.history.map(o => { const past = getRecord(row.professor.id, tool.id, o.period); return <div className="history-item" key={o.period}><span className="small muted">{formatPeriod(o.period)}</span><StateBadge state={past.state} label={configOnly ? `Configurada: ${configuredLabel(o.configured)}` : plainLabel(past)}/>{!SELECTABLE_PERIODS.includes(o.period) && <p>inicio de los datos</p>}</div>; })}</div>
    {row.history.some(o => !SELECTABLE_PERIODS.includes(o.period)) && <p className="small muted">{configOnly ? "" : `Los datos empiezan en ${SINCE}: quien ya la usaba en ${SINCE} sale en Adopta aunque la usara desde antes. `}{configOnly ? `${EARLY.join(" y ")} se muestran` : `Por eso ${EARLY.join(" y ")} se muestran`} solo como historia y no se pueden elegir arriba.</p>}
    {nextGroups && <details className="detail-disclosure"><summary>Grupo probable {nextTerm}, si vuelve a dictar: {GROUPS[likely].name} ({Math.round(nextGroups[likely] * 100)}&nbsp;%)</summary><div className="bar-list is-compact next-groups">{GROUPS.map((g, i) => <div className="bar-row" key={g.id}><span className="bar-label">{g.name}</span><span className="bar-track"><span className="bar-fill" style={{ "--bar-width": `${nextGroups[i] * 100}%` } as CSSProperties}/></span><span className="bar-value">{Math.round(nextGroups[i] * 100)}&nbsp;%</span></div>)}<p className="bar-detail">Probabilidad de cada grupo si vuelve a dictar el semestre siguiente. Los grupos describen combinaciones de herramientas configuradas; no son niveles ni notas.</p></div></details>}
  </Dialog>;
}

function SelectionDialog({ selection, period, outside, downloaded, onRemovePerson, onRemovePair, onClear, onExport, onGoList, onClose }: { selection: Selection; period: Filters["period"]; outside: number; downloaded: string; onRemovePerson: (id: string) => void; onRemovePair: (id: string, toolId: ToolId) => void; onClear: () => void; onExport: () => void; onGoList: () => void; onClose: () => void }) {
  // No data gives a workshop quota, so it starts empty and only the person preparing the call sets it.
  const [capacity, setCapacity] = useState<number | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  // By person by default: the file has one row per person in code order (decision 3.18).
  const [byWorkshop, setByWorkshop] = useState(false);
  const selected = PROFESSORS.filter(p => selection[p.id]?.length);
  const pairs = selected.reduce((n, p) => n + selection[p.id].length, 0);
  const tools = TOOLS.filter(t => selected.some(p => selection[p.id].includes(t.id)));
  const label = formatPeriod(period);
  const over = capacity === null ? 0 : selected.length - capacity;
  const taughtNote = (p: Professor) => { const at = lastTaughtPeriod(p, period); return at === period ? "" : at ? ` · no dictó en ${label}: se exporta su estado de ${formatPeriod(at)}` : ` · no había dictado hasta ${label}`; };
  const faculty = (p: Professor) => facultyLong(facultyAt(p, period));
  const guidanceFor = (p: Professor, t: Tool) => { const at = lastTaughtPeriod(p, period); return at && !isConfigOnly(t) ? ` · Qué conversar: ${GUIDANCE[getRecord(p.id, t.id, at).state]}` : ""; };
  // Shown here, never in the file: the file leaves probabilities out until Conecta-TE approves them.
  const forecastFor = (p: Professor, t: Tool) => { const at = lastTaughtPeriod(p, period); const value = at ? getRecord(p.id, t.id, at).probability : null; return value === null ? "" : ` · Probabilidad de configurarla ${nextTerm}: ${formatProbability(value)}`; };
  const pairButton = (p: Professor, t: Tool) => <button className="chip-remove" onClick={() => onRemovePair(p.id, t.id)} aria-label={`Quitar a ${p.name} del taller de ${t.name}`}><Icon name="close" size={11}/></button>;
  return <Dialog title="Tu próxima convocatoria" eyebrow="LISTA PARA REVISAR ANTES DE INVITAR" onClose={onClose} wide footer={<>{downloaded && <p className="download-note" role="status"><Icon name="check" size={15}/>{downloaded}</p>}{clearConfirm ? <span className="clear-confirm"><span className="small">¿Quitar a {selected.length === 1 ? "la persona" : `los ${number(selected.length)} profesores`} de la convocatoria? No se puede deshacer.</span><button className="button button-secondary" onClick={() => { onClear(); setClearConfirm(false); }}>Sí, vaciar</button><button className="text-link" onClick={() => setClearConfirm(false)}>No, mantener</button></span> : <button className="text-link" disabled={!selected.length} onClick={() => setClearConfirm(true)}>Vaciar convocatoria</button>}<button className="button button-primary" disabled={!selected.length} onClick={() => { setClearConfirm(false); onExport(); }}><Icon name="download" size={17}/> Descargar lista ({plural(selected.length, "profesor", "profesores")})</button></>}>
    <p className="muted">Revisa a quién vas a invitar y a qué taller antes de preparar la invitación.</p>
    <div className="selection-summary"><div><strong>{number(selected.length)}</strong><span>{selected.length === 1 ? "profesor" : "profesores"} · cada uno cuenta una vez</span></div><div><strong>{number(pairs)}</strong><span>{pairs === 1 ? "lugar en un taller" : "lugares en talleres"} · un profesor en 2 talleres ocupa 2</span></div><div><strong>{number(tools.length)}</strong><span>{tools.length === 1 ? "taller distinto" : "talleres distintos"}</span></div><label className="field"><span className="field-label">Cupo (opcional)</span><input type="number" aria-label="Cupo (opcional)" min="1" max="500" placeholder="Sin cupo" value={capacity ?? ""} onChange={e => setCapacity(e.target.value === "" ? null : Math.max(1, Math.min(500, Number(e.target.value) || 1)))}/><small className="field-help">Cuántas personas caben en total. Se compara con el total de profesores de la convocatoria, no por taller. Solo avisa: no quita a nadie.</small></label></div>
    {over > 0 && <div className="callout"><Icon name="info"/><p>Hay {plural(over, "persona", "personas")} más que el cupo ({number(selected.length)} marcadas, cupo {number(capacity!)}). Puedes quitar a alguien antes de descargar.</p></div>}
    {outside > 0 && <p className="small muted">{plural(outside, "profesor", "profesores")} de la convocatoria {outside === 1 ? "no se ve" : "no se ven"} con los filtros actuales de la lista; igual {outside === 1 ? "se descarga" : "se descargan"}.</p>}
    {selected.length ? <>
      <div className="segmented" aria-label="Cómo ver la convocatoria"><button data-active={!byWorkshop} aria-pressed={!byWorkshop} onClick={() => setByWorkshop(false)}>Por persona</button><button data-active={byWorkshop} aria-pressed={byWorkshop} onClick={() => setByWorkshop(true)}>Por taller</button></div>
      {byWorkshop ? <>{tools.map(t => { const people = selected.filter(p => selection[p.id].includes(t.id)); return <section className="selection-group" key={t.id}><h3>Taller: {t.workshop} ({t.name}) · {plural(people.length, "profesor", "profesores")}</h3><div className="selection-list">{people.map(p => { const others = TOOLS.filter(o => o.id !== t.id && selection[p.id].includes(o.id)); return <div className="selection-item" key={p.id}><PersonIcon initials={p.initials}/><div><strong>{p.name}</strong><p className="small muted">{faculty(p)} · {selectionState(p.id, t.id, period)}{guidanceFor(p, t)}{forecastFor(p, t)}{others.length ? ` · También en: ${others.map(o => o.name).join(", ")}` : ""}{taughtNote(p)}</p></div>{pairButton(p, t)}</div>; })}</div></section>; })}<p className="small muted">El archivo tiene una fila por profesor, con todos sus talleres, en orden de código.{selected.some(p => tools.some(t => selection[p.id].includes(t.id) && forecastFor(p, t))) && " La probabilidad vale si vuelve a dictar y no mide si el taller le servirá ni el mérito del profesor; no va en el archivo."}</p></>
        : <div className="selection-list">{selected.map(p => <div className="selection-item" key={p.id}><PersonIcon initials={p.initials}/><div><strong>{p.name}</strong><p className="small muted">{faculty(p)}{taughtNote(p)}</p><div className="selected-tools">{TOOLS.filter(t => selection[p.id].includes(t.id)).map(t => <span key={t.id}><strong>{t.name}</strong> · {selectionState(p.id, t.id, period)}{pairButton(p, t)}</span>)}</div></div><button className="button button-ghost" onClick={() => onRemovePerson(p.id)} aria-label={`Quitar a ${p.name} de toda la convocatoria`}><Icon name="close" size={15}/><span className="remove-label">Quitar de toda la convocatoria</span></button></div>)}</div>}
    </> : <EmptyState title="Aún no hay nadie en la convocatoria" description="Elige arriba una herramienta (cada una tiene su taller), ve a «Elegir profesores» y marca a quién quieres." action={<button className="button button-secondary" onClick={onGoList}>Ir a «Elegir profesores»</button>}/>}
    <h3>Antes de descargar</h3><ul className="small muted"><li>El archivo trae a todas las personas de la convocatoria, también a las que no se ven con los filtros actuales.</li><li>El estado es el de {label}. Si alguien no dictó en {label}, sale con el estado de su último semestre dictado y ese semestre al lado.</li><li>Esta lista se guarda solo en este navegador de este computador: otra persona del equipo no la ve y se pierde si se borran los datos del navegador. Para guardarla o compartirla, descárgala.</li><li>El archivo no trae la probabilidad, el grupo, «Qué conversar» ni el porqué del estado: eso se ve en el tablero.</li><li>{TEXTS.selection}</li><li>Descargar no envía invitaciones.</li></ul>
  </Dialog>;
}

const GUIDE: [GuideSection, string][] = [["taller", "La herramienta y su taller"], ["estados", "Los estados"], ["configurada", "Configurada y uso con estudiantes"], ["reglas", "Reglas (provisionales)"], ["grupos", "Los grupos"], ["pronostico", "El pronóstico"], ["tablero", "Sobre este tablero"]];

function MethodDialog({ section, tool, onClose }: { section?: GuideSection; tool: Tool; onClose: () => void }) {
  // First semester with any known value per tool: external tools start later («datos desde 2024-2»).
  const firstData = useMemo(() => { const first = new Map<ToolId, PeriodId>(); for (const row of OBSERVATIONS) if (row.configured !== null && (!first.has(row.toolId) || row.period < first.get(row.toolId)!)) first.set(row.toolId, row.period); return first; }, []);
  const go = (id: GuideSection) => document.getElementById(`guia-${id}`)?.scrollIntoView();
  useEffect(() => { if (section) go(section); }, [section]);
  const heading = (id: GuideSection) => <h3 id={`guia-${id}`}>{GUIDE.findIndex(([key]) => key === id) + 1}. {GUIDE.find(([key]) => key === id)![1]}</h3>;
  return <Dialog title="Guía del tablero" eyebrow="CÓMO LEER ESTE TABLERO" onClose={onClose} wide>
    <nav className="guide-index" aria-label="Secciones de la guía">{GUIDE.map(([id, title], i) => <button key={id} className="text-link" onClick={() => go(id)}>{i + 1}. {title}</button>)}</nav>
    <section>{heading("taller")}<p>Cada herramienta de Bloque Neón tiene un taller sugerido. Eliges la herramienta arriba y todo el tablero muestra esa herramienta. Los nombres de taller son sugerencias iniciales del equipo, pendientes de aprobación de Conecta-TE; «(taller provisional)» quiere decir que el nombre lo propuso el equipo y falta confirmarlo en el catálogo de Conecta-TE.</p>
      <div className="table-wrap"><table className="data-table as-cards guide-table"><thead><tr><th>Herramienta</th><th>Qué es</th><th>Taller sugerido</th><th>Qué dato hay</th><th>Corte de Apropia</th><th>Pronóstico</th></tr></thead><tbody>{TOOLS.map(t => { const since = firstData.get(t.id); return <tr key={t.id}><td className="guide-tool">{t.name}</td><td className="table-reason" data-label="Qué es">{t.description}</td><td className="table-reason" data-label="Taller sugerido">{t.workshop}</td><td className="table-reason" data-label="Qué dato hay">{isConfigOnly(t) ? "Solo configuración" : "Uso con estudiantes"}{since && since > PERIODS[0] ? ` (datos desde ${formatPeriod(since)})` : ""}</td><td data-label="Corte de Apropia">{t.threshold === null ? "—" : `más de ${number(t.threshold)}`}</td><td data-label="Pronóstico">{t.forecast === false ? "No" : "Sí"}</td></tr>; })}</tbody></table></div></section>
    <section>{heading("estados")}<p>Cada profesor tiene un estado distinto en cada herramienta; por ejemplo, Usa en Contenidos y No expuesto en Rúbricas. Los 5 estados vienen del marco del proyecto, inspirado en DigCompEdu (un marco europeo de competencias digitales de los docentes). Aquí solo miden qué herramientas se usan con estudiantes y cuánto, no la competencia del profesor.</p>
      <div className="method-states">{STATES.map(s => <div key={s}><StateBadge state={s}/><p>{STATE_PLAIN[s]} <strong>Qué conversar:</strong> {GUIDANCE[s]}.<span className="framework-note">Definición del marco: {stateDescriptions[s]}</span></p></div>)}{conditionsShown.map(c => <div key={c}><StateBadge state="Sin información" label={c === "configuracion" ? "Configurada: sí / no / sin dato" : CASE_LABELS[c]}/><p>{conditionDescriptions[c]}{c !== "configuracion" && <> <strong>Qué conversar:</strong> {GUIDANCE["Sin información"]}.</>}<span className="framework-note">Nombre técnico: «{CONDITION_LABELS[c]}».</span></p></div>)}</div>
      <p>{conditionsShown.map(c => `«${c === "configuracion" ? "Configurada" : CASE_LABELS[c]}»`).join(", ").replace(/, ([^,]*)$/, " y $1")} no son estados: no entran en los porcentajes, pero cada caso se cuenta y se explica aparte. No se cuentan como Abandona.{EARLY.length > 0 && ` Los estados se consultan desde ${formatPeriod(SELECTABLE_PERIODS[0])}; ${EARLY.join(" y ")} quedan solo como historia.`}</p></section>
    <section>{heading("configurada")}<p>{CONFIG_HELP}</p><p>Configuración y uso con estudiantes son evidencias distintas. El pronóstico estima empezar a configurar; no predice los estados.</p>{SHARED_KNOWN && <p>Cuando varios docentes dictan la misma aula, la herramienta cuenta para cada uno, aunque tal vez la configuró una sola persona. La ficha lo avisa cuando todas las aulas del profesor en ese semestre son compartidas.</p>}{Object.keys(COUNTED).length > 0 && <ul>{TOOLS.filter(t => COUNTED[t.id]).map(t => <li key={t.id}><strong>{t.name}:</strong> {COUNTED[t.id]}</li>)}</ul>}</section>
    <section>{heading("reglas")}<details open><summary>{TEXTS.rulesTitle}</summary><ul>{TEXTS.plainRules(tool).map(text => <li key={text}>{text}</li>)}</ul>{USE_TOOLS.length < TOOLS.length && <p>{TOOLS.filter(isConfigOnly).map(t => t.name).join(", ").replace(/, ([^,]*)$/, " y $1")}: solo hay datos de configuración, así que no reciben estado.</p>}<details><summary>Ver detalle técnico</summary>{TEXTS.rules.map(text => <p key={text}>{text}</p>)}<p>Valor típico = mediana del tramo activo (sus semestres seguidos de uso). Corte = percentil 75.</p><p>{conditionsShown.map(c => `«${CONDITION_LABELS[c]}»`).join(", ").replace(/, ([^,]*)$/, " y $1")} no son etapas del marco: quedan fuera de los porcentajes, cada caso con su número y su explicación. No se convierten automáticamente en abandono.</p></details></details></section>
    <section>{heading("grupos")}<div className="method-states guide-groups">{GROUPS.map(g => <div key={g.id}><strong>{g.name}</strong><p>{g.description}</p></div>)}</div><p>{TEXTS.groupsOrigin} Son una descripción: no son un nivel ni una nota.</p><ul><li>Grupo en un semestre: el del semestre que miras (ficha).</li><li>Grupo en su semestre anterior: el del último semestre que dictó antes (Elegir profesores y Grupos parecidos). Se usa para comparar porque el grupo de un semestre se arma con lo que configuró ese mismo semestre.</li>{TEXTS.forecastOrigin && <li>Grupo en {formatPeriod(TEXTS.forecastOrigin)} (Pronóstico): el del semestre del que parte el pronóstico.</li>}<li>Grupo probable {nextTerm}: pronóstico que aparece en la ficha.</li></ul><p>Ojo al comparar: los grupos se armaron mirando qué herramientas configura cada profesor. Por eso, parte de las diferencias entre grupos viene de cómo se armaron y no es un hallazgo nuevo. Los grupos describen qué combinación de herramientas configura cada profesor. No son una escala de calidad ni niveles de competencia.</p></section>
    <section>{heading("pronostico")}<p>Qué estima: la probabilidad de que un profesor configure la herramienta en al menos un aula la próxima vez que dicte{TARGET ? ` (${formatPeriod(TARGET)})` : ""}, para quienes no la tenían configurada. No predice los estados (Adopta, Usa, Apropia o Abandona) ni el beneficio de un taller.</p><p>{TEXTS.modelPlain}</p>{TEXTS.relativeBands && <p>Lo habitual: la parte de los casos revisados que configuró la herramienta; es la referencia de los 3 rangos: más del doble de lo habitual, entre lo habitual y el doble, y menos que lo habitual. Los rangos sirven para explorar; no son niveles de adopción ni de calidad docente.</p>}<p>{TEXTS.estimates}</p><details><summary>Ver detalle técnico</summary><p>{TEXTS.model}</p></details></section>
    <section>{heading("tablero")}<p>{TEXTS.method} No mide calidad docente ni aprendizaje, ni demuestra que un taller cause un cambio (efecto causal).</p><details><summary>Cómo se diseñó este tablero</summary><p>Las barras sirven para comparar cantidades; las tablas, para revisar y elegir personas. Los grupos son combinaciones de herramientas y no tienen orden de mérito.</p><p>Seguimos el modelo de Tamara Munzner (autora de un método para diseñar visualizaciones): entender la decisión de Conecta-TE, definir datos y tareas, elegir representaciones e interacciones y comprobar su consistencia. Las barras facilitan comparar cantidades; las tablas permiten revisar y seleccionar personas. Los grupos de uso son categorías descriptivas y no tienen orden de mérito.</p><p>DIDACTA: pendiente de confirmar con el equipo qué nombra.</p></details></section>
  </Dialog>;
}
