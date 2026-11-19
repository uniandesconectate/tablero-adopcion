"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DATA_SOURCE, FACULTIES, GROUPS, MIN_PROFESSORS, OBSERVATIONS, PERIODS, PROFESSORS, SELECTABLE_PERIODS, SELECTION_KEY, TEXTS, TOOLS, VALIDATION_ROWS, nextGroupProbabilities, onSource } from "@/lib/data";
import { COUNTED, DEFAULT_PERIOD, DEFAULT_TOOL, GUIDANCE, antecedents, byCode, byProbability, configuredLabel, exportSelectionCsv, facultyAt, facultyLong, formatPeriod, formatProbability, getRecord, getRecords, habitualRate, lastTaughtPeriod, plainLabel, plainReason, probabilityBandFor, selectionState, share, shown, summarize, typicalIntensity } from "@/lib/domain";
import { BANDS, CASE_LABELS, CONDITION_LABELS, STATES, type AdoptionState, type Condition, type Filters, type GuideSection, type PageProps, type PeriodId, type Professor, type Selection, type TeacherToolRecord, type Tool, type ToolId, type ViewId } from "@/lib/types";
import { GroupsPage, PredictionsPage } from "./analytics-pages";
import { Dialog, EmptyState, Icon, Metric, OffOrigin, PersonIcon, Probability, SINCE, STATE_PLAIN, STATE_SHORT, SectionHeading, StateBadge, StateBars, TARGET, bandText, conditionDescriptions, fewNote, nextTerm, number, offOrigin, plural, stateDescriptions, trackSentence, workshopNote, MODEL_TERMS } from "./ui";

const CONFIGURED_OPTIONS = { si: "Sí", no: "No", "sin-dato": "Sin dato" } as const;
/** Places per workshop, by tool; a workshop without a number has no quota. */
type Capacity = Partial<Record<ToolId, number>>;
const capacityValue = (value: string) => value === "" ? undefined : Math.max(1, Math.min(500, Number(value) || 1));
/** «25 de 25: cupo completo», or how many are over or free; null without a quota. */
function capacityStatus(count: number, quota: number | undefined): { over: number; text: string } | null {
  if (quota === undefined) return null;
  const over = count - quota;
  return { over, text: over > 0 ? `sobran ${plural(over, "persona", "personas")} (${number(count)} marcadas, cupo de ${number(quota)})` : over === 0 ? `cupo completo (${number(count)} de ${number(quota)})` : `${plural(-over, "lugar libre", "lugares libres")} (${number(count)} de ${number(quota)})` };
}
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
/** The list for a workshop opens on the people who do not use the tool yet; «Ver a todos» stays one click away. */
const workshopPatch = (tool: Tool): Partial<Filters> => ({ ...listPatch, ...(isConfigOnly(tool) ? { configured: "no" as const } : { state: "No expuesto" as const }) });
const unfiltered = (f: Filters) => f.state === "Todos" && f.group === "Todos" && !f.search && f.probability === "Todas" && f.configured === "Todos";
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
  // No data gives a workshop quota, so each starts empty; kept in memory only, never stored.
  const [capacity, setCapacity] = useState<Capacity>({});
  // Why each «professor:tool» was marked (the list's filters) and a note for the file: memory only, the stored call list is untouched.
  const [criteria, setCriteria] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const menuButton = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
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
  useEffect(() => { document.title = `${activeView.name} · Conecta-TE`; }, [activeView.name]);
  // The open phone menu takes the focus; Escape closes it and gives the focus back to its button.
  useEffect(() => {
    if (!menuOpen) return;
    sidebar.current?.querySelector<HTMLElement>(".nav-item")?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenu(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);

  // The page behind the menu is inert until the next render, so the focus goes back to the menu button after it.
  const closeMenu = () => { setMenuOpen(false); setTimeout(() => menuButton.current?.focus(), 0); };
  const onFilters = (patch: Partial<Filters>) => setFilters(current => ({ ...current, ...patch }));
  const onNavigate = (next: ViewId, patch: Partial<Filters> = {}) => {
    const nextFilters = { ...filters, ...patch };
    if (next !== view) window.history.pushState(null, "", locationFor(next, nextFilters));
    setFilters(nextFilters); setView(next); setMenuOpen(false);
    window.scrollTo({ top: 0 });
    setTimeout(() => document.querySelector<HTMLElement>("main h1")?.focus(), 0);
  };
  const setPairs = (pairs: [string, ToolId][], add: boolean, why?: string) => {
    setCriteria(current => { const next = { ...current }; for (const [id, toolId] of pairs) { if (add && why) next[`${id}:${toolId}`] = why; else if (!add) delete next[`${id}:${toolId}`]; } return next; });
    setSelection(current => {
    const next = { ...current };
    pairs.forEach(([id, toolId]) => {
      const old = next[id] ?? [];
      const tools = add ? [...new Set([...old, toolId])] : old.filter(t => t !== toolId);
      if (tools.length) next[id] = tools; else delete next[id];
    });
    return next;
    });
  };
  const toggle = (record: TeacherToolRecord, why = "desde su ficha") => setPairs([[record.professor.id, record.tool.id]], !selection[record.professor.id]?.includes(record.tool.id), why);
  const selectMany = (records: TeacherToolRecord[], add: boolean, why?: string) => setPairs(records.map(r => [r.professor.id, r.tool.id]), add, why);
  const download = () => {
    const name = TEXTS.csvName(filters.period);
    const blob = new Blob([exportSelectionCsv(selection, filters.period, { criteria, note })], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setDownloaded(`Listo: se descargó «${name}» con ${plural(Object.keys(selection).length, "profesor", "profesores")}, una fila por persona. No se envió ninguna invitación.`);
  };
  // From the menu or an empty call list, an unfiltered list opens on the workshop's people.
  const goList = () => onNavigate("profesores", unfiltered(filters) ? workshopPatch(tool) : {});
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
    {menuOpen && <button className="mobile-overlay" aria-label="Cerrar menú" onClick={closeMenu}/>}
    <aside ref={sidebar} className={`sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Navegación principal">
      <button className="button button-icon sidebar-close" aria-label="Cerrar menú" onClick={closeMenu}><Icon name="close"/></button>
      <a href="?vista=resumen" className="brand" onClick={event => { event.preventDefault(); onNavigate("resumen"); }}>
        <span className="brand-symbol" aria-hidden="true"><span/><span/><span/><span/></span><span className="brand-text">Conecta<span>—</span>TE<small className="brand-subtitle">Universidad de los Andes</small></span>
      </a>
      <div className="sidebar-label">Adopción y acompañamiento</div>
      <p className="sidebar-context">Mirando: <strong>{tool.name}</strong> · {period}</p>
      <nav className="nav-list">{NAV.map(item => <button key={item.id} className="nav-item" aria-current={view === item.id ? "page" : undefined} onClick={() => item.id === "profesores" ? goList() : onNavigate(item.id)}><Icon name={item.icon}/><span>{item.name}</span></button>)}</nav>
      <button className="text-link sidebar-guide" onClick={() => openGuide()}><Icon name="info" size={16}/> Guía del tablero</button>
      <div className="sidebar-bottom"><div className="sidebar-note"><Icon name="leaf" size={25}/><p>Los datos abren<br/><strong>conversaciones.</strong></p><span>El acompañamiento<br/>lo decides tú.</span></div><div className="sidebar-signature">DIDACTA <span>·</span> Conecta-TE</div></div>
    </aside>
    {/* While the phone menu is open, the page behind it is out of reach for the keyboard. */}
    <div className="main-shell" inert={menuOpen}>
      <header className="topbar"><div className="breadcrumbs"><button ref={menuButton} className="button button-icon mobile-menu" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Icon name="menu"/></button><span>Estrategias de adopción</span><Icon name="chevron" size={13}/><strong>{activeView.name}</strong></div><div className="topbar-actions"><span className="demo-badge" title={`${DATA_SOURCE}: datos de profesores reales, con código seudónimo`}><span/> {TEXTS.badge}</span><button className="button button-ghost topbar-guide" aria-label="Guía del tablero" onClick={() => openGuide()}><Icon name="info" size={16}/><span>Guía</span></button><button className="button button-ghost change-file" aria-label="Cambiar archivo" onClick={onChangeFile}><Icon name="upload" size={16}/><span>Cambiar archivo</span></button><button className="selection-button" onClick={() => setDialog("selection")}><Icon name="users" size={17}/><span>Convocatoria ({number(selectedCount)})</span></button></div></header>
      <main id="contenido" className="workspace">
        <div className="global-filters">
          <span className="global-filters-label"><Icon name="calendar" size={16}/> Qué estás mirando</span>
          <label className="field tool-field"><span className="field-label">Herramienta</span><select aria-label="Herramienta" value={filters.tool} onChange={e => onFilters(toolPatch(e.target.value))}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}{isConfigOnly(t) ? " · solo configuración" : ""}</option>)}</select></label>
          <label className="field"><span className="field-label">Semestre</span><select aria-label="Semestre" value={filters.period} onChange={e => onFilters({ period: e.target.value as Filters["period"] })}>{[...SELECTABLE_PERIODS].reverse().map(p => <option key={p} value={p}>{formatPeriod(p)}</option>)}</select></label>
          <label className="field faculty-field"><span className="field-label">Facultad</span><select aria-label="Facultad" value={filters.faculty} onChange={e => onFilters({ faculty: e.target.value })}><option value="Todos">Todas las facultades</option>{faculties.map(f => <option key={f} value={f}>{facultyLong(f)}{facultyCounts.get(f) ? "" : ` · sin profesores en ${period}`}</option>)}</select></label>
          <span className="global-filters-note">Datos al cierre de {period}{forecastNote}</span>
          <div className="workshop-line">{view !== "herramientas" && <p>Taller sugerido: <strong>{tool.workshop}</strong>{workshopNote(tool) && <span className="muted"> · {workshopNote(tool).replace(/^S/, "s").replace(/\.$/, "")}</span>}{isConfigOnly(tool) && <span className="muted"> · {tool.name} es de solo configuración: sabemos si está puesta en sus aulas, no si sus estudiantes la usan</span>}</p>}
            <details className="context-help"><summary>¿Configurada o usada? Más sobre estos datos</summary><p>Datos al cierre de {period}{forecastNote}.{isConfigOnly(tool) ? ` De ${tool.name} solo sabemos si está configurada.` : ""} {CONFIG_HELP}</p><p>«Solo configuración», junto al nombre de algunas herramientas: de ellas solo sabemos si están configuradas, no si los estudiantes las usan; por eso no tienen estado (Adopta, Usa…).</p><p>Fechas: los estados se calculan con los datos desde {SINCE}.{EARLY.length > 0 && ` El selector de semestre y las gráficas empiezan en ${formatPeriod(SELECTABLE_PERIODS[0])}; ${EARLY.join(" y ")} quedan solo como historia.`} Algunas frases del pronóstico cuentan semestres de configuración anteriores a {SINCE}, porque el pronóstico usa una historia de configuración más larga.</p></details></div>
        </div>
        {filters.period !== DEFAULT_PERIOD && <div className="callout old-period"><Icon name="calendar"/><div><p><strong>Estás mirando {period}, no {formatPeriod(DEFAULT_PERIOD)}, el semestre más reciente.</strong> Los estados son los de {period}{TEXTS.forecastOrigin ? ` y no hay probabilidad (solo existe con datos de ${formatPeriod(TEXTS.forecastOrigin)})` : ""}. Si armas una convocatoria así, el archivo sale con los estados de {period}.</p><button className="button button-secondary" onClick={() => onFilters({ period: DEFAULT_PERIOD })}>Volver a {formatPeriod(DEFAULT_PERIOD)}</button></div></div>}
        {taughtHere === 0 ? <div className="callout"><Icon name="info"/><p>{filters.faculty === "Todos" ? "Ningún profesor" : `Ningún profesor de ${facultyLong(filters.faculty)}`} dictó en {period}. Elige otro semestre u otra facultad.</p></div>
          : taughtHere < MIN_PROFESSORS && <div className="callout"><Icon name="info"/><p>{facultyText(filters.faculty)} tiene {plural(taughtHere, "profesor", "profesores")} en {period}. Con menos de {MIN_PROFESSORS} profesores mostramos cantidades y no porcentajes, porque con tan pocas personas un porcentaje cambia mucho por una sola.</p></div>}
        <div key={view} className="page-content">
          {view === "resumen" && <SummaryPage {...props}/>}
          {view === "herramientas" && <ToolsPage {...props}/>}
          {view === "profesores" && <ProfessorsPage {...props} selection={selection} onToggle={toggle} onSelectMany={selectMany} onSelection={() => setDialog("selection")} capacity={capacity} onCapacity={setCapacity}/>}
          {view === "grupos" && <GroupsPage {...props}/>}
          {view === "predicciones" && <PredictionsPage {...props}/>}
        </div>
        <footer className="app-footer"><span>Conecta-TE <span aria-hidden="true">↗</span> Una mirada para acompañar</span><span>{DATA_SOURCE} <span>·</span> {period}</span></footer>
      </main>
    </div>
    {dialog === "method" && <MethodDialog section={guideSection} tool={tool} onClose={() => setDialog(null)}/>}
    {professor && <ProfessorDialog record={professor} currentTool={tool} selection={selection} onToggle={toggle} onClose={() => setProfessor(null)}/>}
    {dialog === "selection" && <SelectionDialog selection={selection} period={filters.period} capacity={capacity} onCapacity={setCapacity} note={note} onNote={setNote} outside={outside} downloaded={downloaded} onRemovePerson={id => setSelection(current => { const next = { ...current }; delete next[id]; return next; })} onRemovePair={(id, toolId) => setPairs([[id, toolId]], false)} onClear={() => setSelection({})} onExport={download} onGoList={() => { setDialog(null); setDownloaded(""); goList(); }} onClose={() => { setDialog(null); setDownloaded(""); }}/>}
  </div>;
}

/** `title` says what to do on the page; `tagline` keeps the page's motto. */
function PageHeading({ eyebrow, title, tagline, description, action }: { eyebrow: string; title: string; tagline: string; description?: ReactNode; action?: ReactNode }) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1 tabIndex={-1}>{title}</h1><p className="page-tagline">{tagline}</p>{description && <p className="page-description">{description}</p>}</div>{action && <div className="heading-actions">{action}</div>}</div>;
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
  const highRecords = withProbability.filter(r => probabilityBandFor(r.tool.id, r.probability!) === "Alta");
  const high = highRecords.length;
  const highHistory = antecedents(highRecords);
  // Count per state of the high-probability people, so the option says which conversations it mixes.
  const highStates = [...new Set(highRecords.map(plainLabel))].map(label => [label, highRecords.filter(r => plainLabel(r) === label).length] as const).sort((x, y) => y[1] - x[1]).map(([label, n]) => `${number(n)} en ${label}`).join(", ");
  const mine = rows.find(row => row.tool.id === tool.id);
  const sorted = [...rows].sort((a, b) => mode === "rate" ? (b.evaluated ? b.count / b.evaluated : 0) - (a.evaluated ? a.count / a.evaluated : 0) : b.count - a.count);
  const open = (patch: Partial<Filters>) => onNavigate("profesores", { ...listPatch, ...patch });
  const option = (label: ReactNode, note: string, onClick: () => void, primary = false, disabled = false) => <><button className={primary ? "button button-primary hero-option" : "hero-option"} disabled={disabled} onClick={onClick}><span>{label}</span><Icon name="arrow" size={16}/></button><p className="hero-option-note">{note}</p></>;
  const highNote = `Quienes más probablemente la configuren si vuelven a dictar; no mide si el taller les servirá.${configOnly ? ` Están dentro de los ${number(measurable - configured)} que no la tienen configurada.` : ` Mezcla estados (${highStates}): para que el taller tenga una sola conversación, filtra por estado en la lista.`}${highHistory.before ? ` ${plural(highHistory.before, "la tuvo", "la tuvieron")} configurada en algún semestre anterior y hoy no: el taller puede apoyar un regreso.` : ""} ${trackSentence(tool.id, "Alta")}`;
  const highOption = forecastHere && high > 0 && option(<>Ver a {high === 1 ? "la persona" : `los ${number(high)}`} con probabilidad alta de configurarla {nextTerm}</>, highNote, () => open({ probability: "Alta" }));
  const kicker = ["DEL DATO A LA CONVERSACIÓN", tool.name, period, facultyText(filters.faculty)].join(" · ").toLocaleUpperCase("es");
  const forWhat = (state: AdoptionState) => `Para ${GUIDANCE[state].replace(/^./, c => c.toLocaleLowerCase("es"))}.`;
  // The first option is the same list «Armar la lista de este taller» opens, so both screens point to the same place.
  const sameList = `Es la misma lista que abre «Armar la lista de este taller»${forecastHere ? ", de mayor a menor probabilidad de configurarla: con pocos cupos, toma a los primeros" : ""}.`;
  return <>
    <div className="hero-grid"><div className="hero-copy"><p className="eyebrow">01 / RESUMEN</p><h1 tabIndex={-1}>¿A quién invitar al taller de {tool.name}?</h1><p className="page-tagline">Paso 1 de 3: elige a qué grupo invitar.</p><p className="page-description">Aquí ves cómo está {tool.name} en {period} y eliges qué grupo de profesores revisar para su taller. {tool.id === DEFAULT_TOOL ? `${tool.name} viene elegida al abrir el tablero; para` : "Para"} otro taller, cambia la herramienta arriba.</p>
      <details className="steps"><summary>Cómo armar una convocatoria, en 3 pasos</summary><p>Entiende cómo se incorporan las herramientas y encuentra dónde ofrecer acompañamiento:</p><ol><li>Elige la herramienta arriba: cada una tiene su taller.</li><li>En «Elegir profesores», marca a quién quieres en la lista del taller.</li><li>Abre «Convocatoria», revisa y descarga la lista.</li></ol></details>
      <button className="text-link" onClick={() => onMethod("estados")}>Guía: qué significa cada estado <Icon name="arrow" size={16}/></button></div>
      <div className="hero-card"><span className="hero-card-kicker"><Icon name="spark" size={17}/> {kicker}</span>
        <h2>¿A quién quieres invitar?</h2>
        <div className="hero-options">{configOnly ? <>{measurable > configured && option(`Ver a los ${number(measurable - configured)} que no la tienen configurada`, `Para un primer acercamiento: no la tienen puesta en sus aulas en ${period}. ${sameList}`, () => open({ configured: "no" }), true)}{highOption}{configured > 0 && option(`Ver a ${configured === 1 ? "la persona que ya la tiene" : `los ${number(configured)} que ya la tienen`} configurada`, "Para profundizar con quienes ya la tienen en sus aulas.", () => open({ configured: "si" }))}</>
          : <>{neverUsed > 0 && option(<>Ver a {neverUsed === 1 ? "la persona que no la ha usado" : `los ${number(neverUsed)} que no la han usado`} con estudiantes desde {SINCE} (No expuesto)</>, `${forWhat("No expuesto")} ${sameList}`, () => open({ state: "No expuesto" }), true)}{option(!adopting ? `Nadie empezó en ${period}` : adopting === 1 ? `Ver a la persona que empezó en ${period} (Adopta)` : `Ver a los ${number(adopting)} que empezaron en ${period} (Adopta)`, `${forWhat("Adopta")} Una primera experiencia puede ir más lejos. Todos ya la tienen configurada, así que no hay probabilidad para ordenarlos: con pocos cupos, recorta por facultad o por grupo.`, () => open({ state: "Adopta" }), !neverUsed, !adopting)}{highOption}</>}</div>
        {configOnly ? <p>{measurable ? `${number(configured)} de ${number(measurable)} profesores con dato la tienen configurada en al menos un aula en ${period}${configuredPart.ratio === null ? "" : ` (${configuredPart.text})`}. ` : records.length ? "Este semestre no hay dato de configuración: la herramienta no estaba activada. " : "Ningún profesor de este contexto dictó este semestre. "}De {tool.name} solo sabemos si está configurada, no si sus estudiantes la usan, así que no recibe estado (Adopta, Usa…).</p>
          : <p>{records.length ? <>En {period}, {plural(adopting, "profesor usó", "profesores usaron")} {tool.name} con sus estudiantes por primera vez desde {SINCE} (estado Adopta).{firstTime ? ` ${firstTime === 1 ? "1 de ellos dicta" : `${number(firstTime)} de ellos dictan`} por primera vez en los datos (desde ${SINCE}).` : ""} Acompañarlos puede ayudar a que sigan usándola.</> : `Ningún profesor de este contexto dictó en ${period}: no hay a quién mostrar.`}</p>}
        <p className="hero-note">Cada opción abre un grupo de profesores para este mismo taller, y los grupos se cruzan: {configOnly ? "quienes tienen probabilidad alta están dentro de quienes no la tienen configurada" : "quienes tienen probabilidad alta están sobre todo en No expuesto, y algunos en Abandona o sin estado"}. El grupo depende del tipo de taller: un primer acercamiento, acompañar a quien empieza o profundizar. Esa elección es tuya.</p>
        <button className="text-link hero-link" onClick={() => onNavigate("herramientas")}>Ver cómo está {tool.name} y su taller <Icon name="arrow" size={15}/></button><div className="hero-orbit" aria-hidden="true"/></div></div>
    <div className="metrics-grid">
      <Metric label={`Profesores que dictaron en ${period}`} value={number(records.length)} detail={`${facultyText(filters.faculty)} · cada persona cuenta una vez, aunque dicte varios cursos`} icon="users"/>
      {configOnly ? <Metric label={`${tool.name} configurada en ${period}`} value={configuredPart.ratio === null && measurable ? `${number(configured)} de ${number(measurable)}` : configuredPart.text} detail={`${configuredPart.ratio === null ? measurable ? "Pocos profesores, sin porcentaje" : "Sin profesores con dato de configuración" : `${number(configured)} de ${number(measurable)} profesores con dato la tienen en al menos un aula`} · configuración, no uso con estudiantes`} icon="leaf"/>
        : <Metric label={`Empezaron a usar ${tool.name} en ${period}`} value={plural(adopting, "profesor", "profesores")} detail={started.ratio === null ? couldStart ? `${number(adopting)} de ${number(couldStart)} que no la habían usado con estudiantes antes de ${period} · pocos profesores, sin porcentaje` : "Nadie que aún no la usara" : <>Son el {started.text} de los {number(couldStart)} que no la habían usado con estudiantes antes de {period}.<br/>Esos {number(couldStart)}: {number(adopting)} en Adopta y {number(neverUsed)} en No expuesto.</>} icon="leaf"/>}
      <Metric label={`Con probabilidad alta de configurar ${tool.name} ${nextTerm}`} value={forecastHere ? number(high) : "—"} detail={tool.forecast === false ? `No hay pronóstico para ${tool.name}` : !forecastHere && origin ? <>El pronóstico solo existe con datos de {formatPeriod(origin)}. <button className="text-link" onClick={() => onFilters({ period: origin })}>Ver {formatPeriod(origin)}</button></> : !withProbability.length ? "Nadie con probabilidad calculada en este contexto" : <>{bandText(tool.id, "Alta")} · de {number(withProbability.length)} con probabilidad calculada.{habitualRate(tool.id) !== null && ` Lo habitual en ${tool.name} es ${formatProbability(habitualRate(tool.id)!)}; por eso el corte cambia de una herramienta a otra.`} {trackSentence(tool.id, "Alta")} <button className="text-link" onClick={() => open({ probability: "Alta" })}>Ver la lista</button> <button className="text-link" onClick={() => onNavigate("predicciones")}>Ver qué tan bien acierta</button></>} icon="trend"/>
    </div>
    <details className="panel compare-tools"><summary className="panel-header">Comparar con otras herramientas: ¿en cuál hay más profesores en cada estado? (no cambia la herramienta hasta que toques una barra)</summary><SectionHeading eyebrow="COMPARAR HERRAMIENTAS" title="¿En qué herramienta hay más profesores en cada estado?" description={`Elige un estado. Cada barra dice qué parte de los profesores clasificados en esa herramienta está en ese estado (${period}).${configOnly ? ` ${tool.name} no aparece aquí: solo tiene datos de configuración, sin estados.` : ""}`} action={<div className="segmented" aria-label="Medida de comparación"><button data-active={mode === "rate"} aria-pressed={mode === "rate"} onClick={() => setMode("rate")}>Porcentaje</button><button data-active={mode === "count"} aria-pressed={mode === "count"} onClick={() => setMode("count")}>Cantidad</button></div>}/><div className="panel-body"><div className="state-selector" aria-label="Estado a comparar">{STATES.map(state => <button key={state} className="state-filter" data-active={reviewState === state} aria-pressed={reviewState === state} onClick={() => setReviewState(state)}><span className="state-dot" data-state={state}/><span>{state}<small>{STATE_SHORT[state]}</small></span></button>)}</div><p className="small muted chart-caption">{STATE_PLAIN[reviewState]} Qué conversar: {GUIDANCE[reviewState]} (sugerencia inicial). Toca una barra para ver a esos profesores: el tablero pasa a esa herramienta.</p>{!configOnly && reviewState === "Adopta" && started.ratio !== null && mine?.part.ratio != null && <p className="small chart-caption">Ojo con los porcentajes: aquí Adopta en {tool.name} es el {mine.part.text} porque la base son todos los clasificados en {tool.name}; arriba es el {started.text} porque la base son solo los {number(couldStart)} que no la habían usado antes de {period}. Son las mismas {number(adopting)} personas.</p>}<div className="bar-list tool-comparison">{sorted.map(row => <button className="bar-row" key={row.tool.id} data-mine={row.tool.id === filters.tool || undefined} onClick={() => open({ tool: row.tool.id, state: reviewState })} aria-label={`${row.tool.name}: ${number(row.count)} de ${number(row.evaluated)} en ${reviewState}. Ver profesores`}><span className="bar-label">{row.tool.name}{row.tool.id === filters.tool && <small> · tu herramienta</small>}</span><span className="bar-track"><span className="bar-fill" data-state={reviewState} style={{ "--bar-width": `${mode === "rate" ? (row.part.ratio ?? 0) * 100 : records.length ? row.count / records.length * 100 : 0}%` } as CSSProperties}/></span><span className="bar-value">{mode === "rate" && row.part.ratio !== null ? row.part.text : number(row.count)}<span>{mode === "rate" ? `${number(row.count)} de ${number(row.evaluated)}` : `de ${number(row.evaluated)}${row.part.ratio !== null ? ` (${row.part.text})` : ""}`}</span></span><Icon name="arrowUp" size={16}/></button>)}</div><p className="bar-detail">Cada porcentaje se calcula sobre los profesores clasificados (con uno de los 5 estados) en esa herramienta; por eso la base cambia de una barra a otra. Quienes no tienen estado («{CASE_LABELS.regla}» o «{CASE_LABELS.dato}») no entran en el porcentaje y se cuentan en «¿A cuántos les pudimos dar un estado?», al final de esta página.{onlyUse && ` Solo aparecen las ${USE_TOOLS.length} herramientas con datos de uso con estudiantes; las otras ${TOOLS.length - USE_TOOLS.length} solo tienen datos de configuración y no reciben estado.`}{configOnly && ` Por eso ${tool.name} no aparece aquí.`}{mode === "count" && ` En «Cantidad», el largo de la barra se compara con los ${number(records.length)} profesores que dictaron en ${period}.`}{mode === "rate" && rows.some(row => row.evaluated && row.part.ratio === null) && ` ${fewNote}`}</p></div></details>
    {!configOnly && <aside className="panel accompaniment-note is-wide"><div className="panel-body"><span className="note-icon"><Icon name="clock" size={24}/></span><p className="eyebrow">TAMBIÉN MERECE UNA CONVERSACIÓN</p><h2>Quienes dejaron de usar {tool.name}</h2><p>{plural(abandoning, "profesor dejó", "profesores dejaron")} de usar {tool.name} con sus estudiantes después de usarla 2 o más semestres seguidos (estado Abandona): {number(justLeft)} la {justLeft === 1 ? "dejó" : "dejaron"} en {period} y {number(abandoning - justLeft)} antes. No quiere decir que la {abandoning === 1 ? "dejó" : "dejaron"} para siempre. El dato invita a preguntar qué cambió.</p><button className="button button-secondary" disabled={!abandoning} onClick={() => open({ state: "Abandona" })}>{abandoning === 1 ? "Ver a esta persona" : `Ver a los ${number(abandoning)}`} <Icon name="arrow" size={16}/></button></div></aside>}
    <details className="panel coverage"><summary className="panel-header">Ver detalle: ¿a cuántos les pudimos dar un estado? {fewProfessors ? `${number(evaluated)} de ${number(all.length)} casos` : `${share(evaluated, all.length).text} (${number(evaluated)} de ${number(all.length)} casos)`} en {period} · un caso es un profesor en una herramienta</summary><div className="panel-body"><p>En {period}, cada profesor cuenta una vez por herramienta: {number(records.length)} profesores × {USE_TOOLS.length} herramientas con datos de uso con estudiantes = {number(all.length)} casos. {number(evaluated)} tienen uno de los 5 estados{fewProfessors ? " · pocos profesores, sin porcentaje" : ` (${share(evaluated, all.length).text})`}.</p><p>Los otros {number(all.length - evaluated)} no tienen estado: {number(unclassified("regla"))} «{CASE_LABELS.regla}» (la usaron sin llegar a 2 semestres seguidos, o la retomaron: el dato existe, pero el marco todavía no tiene una regla para ellos) y {number(unclassified("dato"))} «{CASE_LABELS.dato}».{onlyUse && ` Las ${TOOLS.length - USE_TOOLS.length} herramientas que solo tienen datos de configuración no entran en esta cuenta.`}</p><button className="text-link" onClick={() => onMethod("estados")}>Por qué hay casos sin estado <Icon name="arrow" size={15}/></button></div></details>
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
  const forecastHere = tool.forecast !== false && !offOrigin(filters.period);
  const examples = (configOnly ? records.filter(r => r.observation.configured) : records.filter(r => r.state === "Adopta" || r.state === "Abandona")).sort(byCode);
  const eligible = records.filter(r => r.probability !== null);
  const top = [...eligible].sort(byProbability).slice(0, 6);
  const rate = habitualRate(tool.id);
  const open = (patch: Partial<Filters>) => onNavigate("profesores", { ...listPatch, ...patch });
  // The workshop list (see workshopPatch) and, inside it, those with a high probability.
  const listRecords = records.filter(r => configOnly ? r.observation.configured === false : r.state === "No expuesto");
  const listHigh = listRecords.filter(r => r.probability !== null && probabilityBandFor(tool.id, r.probability) === "Alta");
  const highHistory = antecedents(listHigh);
  const trendTop = Math.max(0, ...trends.map(row => share(row.count, row.n).ratio ?? 0));
  return <><PageHeading eyebrow="02 / TALLERES Y HERRAMIENTAS" title={`${tool.name} por dentro: estados, cambios y pronóstico`} tagline="Paso 1 de 3: entiende la herramienta y abre la lista de su taller." description={<>Explora una herramienta y reconoce qué acompañamiento puede tener sentido. Para ver otra, cámbiala arriba, en «Herramienta». <button className="text-link" onClick={() => onMethod("taller")}>Ver las {TOOLS.length} herramientas con su taller</button></>} action={<button className="button button-secondary" onClick={() => onMethod("estados")}><Icon name="info" size={17}/> Guía: los estados</button>}/>
    <div className="tool-heading"><div><p className="eyebrow">HERRAMIENTA Y SU TALLER</p><h2>{tool.name}{configOnly && <small className="muted"> · solo configuración</small>}</h2><p className="muted">{tool.description}</p><p className="workshop-name">Taller sugerido: <strong>{tool.workshop}</strong></p>{workshopNote(tool) && <p className="small muted">{workshopNote(tool)}</p>}<button className="button button-primary" onClick={() => onNavigate("profesores", workshopPatch(tool))}>Armar la lista de este taller <Icon name="arrow" size={16}/></button><p className="small muted">Abre la lista con {plural(listRecords.length, configOnly ? "persona que no la tiene configurada" : "persona que no la ha usado con estudiantes (No expuesto)", configOnly ? "personas que no la tienen configurada" : "personas que no la han usado con estudiantes (No expuesto)")}{forecastHere ? ", de mayor a menor probabilidad de configurarla" : ""}. Es la misma que abre la primera opción del Resumen. Ahí puedes ver a todos con un clic.</p>{forecastHere && listHigh.length > 0 && <p className="small muted">Dentro de esa lista, {plural(listHigh.length, "tiene", "tienen")} probabilidad alta: {bandText(tool.id, "Alta").toLocaleLowerCase("es")}{highHistory.before ? `; ${plural(highHistory.before, "la tuvo", "la tuvieron")} configurada antes y hoy no` : ""}. <button className="text-link" onClick={() => open({ ...workshopPatch(tool), probability: "Alta" })}>Ver solo a {listHigh.length === 1 ? "esa persona" : `esos ${number(listHigh.length)}`}</button></p>}{configOnly && <p className="small muted">«Solo configuración» en la lista de herramientas: de esas herramientas solo sabemos si están configuradas, no si los estudiantes las usan; por eso no tienen estado.</p>}</div><div className="segmented" aria-label="Tipo de información"><button data-active={tab === "observado"} aria-pressed={tab === "observado"} onClick={() => setTab("observado")}>Lo observado ({period})</button><button data-active={tab === "previsto"} aria-pressed={tab === "previsto"} onClick={() => setTab("previsto")}>Lo previsto{TARGET ? ` (${formatPeriod(TARGET)})` : ""}</button></div></div>
    {tab === "observado" ? <>{configOnly ? <section className="panel"><SectionHeading title={`¿Quiénes la tienen configurada? ${tool.name} por semestre, hasta ${period}`}/><div className="panel-body"><ConfigurationShare tool={tool} period={filters.period} faculty={filters.faculty}/><div className="heading-links">{measurable > configured && <button className="button button-secondary" onClick={() => open({ configured: "no" })}>Ver a los {number(measurable - configured)} que no la tienen configurada en {period}</button>}{configured > 0 && <button className="text-link" onClick={() => open({ configured: "si" })}>Ver a los {number(configured)} que la tienen <Icon name="arrow" size={15}/></button>}</div></div></section>
      : <div className="two-column"><section className="panel"><SectionHeading title={`Estado de cada profesor en ${tool.name}, ${period}`} description="La adopción se observa por herramienta, no como una nota del profesor."/><div className="panel-body"><StateBars records={records} onSelect={state => open({ state })}/>{states["Sin información"] > 0 && <button className="text-link" onClick={() => open({ state: "Sin información" })}>Ver a los {number(states["Sin información"])} sin estado <Icon name="arrow" size={15}/></button>}<p className="small muted">Qué conversar: sugerencia inicial según el estado, igual para todos en el mismo estado; pendiente de aprobación de Conecta-TE.</p></div></section>
        <section className="panel"><SectionHeading title={`¿Cómo ha cambiado? Profesores en ${trendState} por semestre`} description="La misma definición, aplicada a cada semestre."/><div className="panel-body"><label className="field trend-field"><span className="field-label">Ver la evolución de</span><select aria-label="Ver la evolución de" value={trendState} onChange={e => setTrendState(e.target.value as AdoptionState)}>{STATES.map(s => <option key={s} value={s}>{s} · {STATE_SHORT[s]}</option>)}</select></label><div className="trend-bars">{trends.map(row => { const part = share(row.count, row.n); return <button key={row.period} className="trend-column" aria-label={`${formatPeriod(row.period)}: ${number(row.count)} de ${number(row.n)} en ${trendState}${part.ratio === null ? "" : ` (${part.text})`}. Ver la lista de ese semestre`} onClick={() => onNavigate("profesores", { ...listPatch, period: row.period, state: trendState })}><span className="trend-number">{part.ratio === null ? number(row.count) : part.text}</span><span className="trend-track"><span data-state={trendState} className="bar-fill" style={{ height: `${trendTop ? (part.ratio ?? 0) / trendTop * 100 : 0}%` }}/></span><span className="trend-label">{formatPeriod(row.period)}</span><span className="small muted">{number(row.count)} de {number(row.n)}</span></button>; })}</div><p className="bar-detail">El número es el porcentaje de profesores clasificados (con uno de los 5 estados) en cada semestre; la base cambia de un semestre a otro. La columna más alta es el semestre con el porcentaje más alto, para que se vean las diferencias pequeñas. Tocar una columna abre la lista de ese semestre y cambia el semestre de todo el tablero (un aviso arriba lo recuerda y deja volver).{trends.some(row => row.n && row.n < MIN_PROFESSORS) && ` ${fewNote}`}</p></div></section></div>}
      <details className="panel examples"><summary className="panel-header">{configOnly ? `Ver 5 ejemplos de profesores con ${tool.name} configurada` : "Ver 5 ejemplos de profesores en Adopta o Abandona"} (los primeros por código, sin orden de prioridad)</summary><div className="panel-body"><p className="small muted">Los 5 primeros por código, no por prioridad.{configOnly ? "" : " La conversación empieza por una persona."}</p><div className="heading-links">{!configOnly && states.Adopta > 0 && <button className="text-link" onClick={() => open({ state: "Adopta" })}>Ver a los {number(states.Adopta)} en Adopta</button>}{!configOnly && states.Abandona > 0 && <button className="text-link" onClick={() => open({ state: "Abandona" })}>Ver a los {number(states.Abandona)} en Abandona</button>}<button className="text-link" onClick={() => open({})}>Ver la lista completa <Icon name="arrow" size={16}/></button></div></div><RecordTable records={examples.slice(0, 5)} onProfessor={onProfessor}/></details>
      <div className="callout"><Icon name="info"/><div><strong>{configOnly ? ruleTitle : "Cómo se decide el estado (reglas provisionales)"}</strong>{configOnly ? <p>{rule}</p> : <><ul>{TEXTS.plainRules(tool).map(text => <li key={text}>{text}</li>)}{TEXTS.unitHelp && <li>{TEXTS.unitHelp}</li>}</ul><details><summary>Ver detalle técnico</summary><p>{rule}</p></details></>}</div></div></>
      : <><div className="callout"><Icon name="trend"/><p><strong>Este pronóstico dice qué tan probable es que el profesor configure {tool.name} en al menos un aula {nextTerm}, si vuelve a dictar.</strong> No dice si sus estudiantes la usarán, en qué estado quedará (Adopta, Usa, Apropia o Abandona) ni si el taller le servirá.</p></div>
        <div className="panel">{tool.forecast === false ? <EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no se calculó la probabilidad de configurarla. Para armar su lista, usa la de quienes no la tienen configurada.`} action={<button className="button button-secondary" onClick={() => open({ configured: "no" })}>Ver a quienes no la tienen configurada</button>}/> : offOrigin(filters.period) ? <OffOrigin period={filters.period} onGo={period => onFilters({ period })}/> : <>
          <SectionHeading title={`¿Quién podría configurar ${tool.name} ${nextTerm}?`} description={`${plural(eligible.length, "profesor tiene", "profesores tienen")} probabilidad calculada. Se calculó con los datos de ${period}, solo para quienes no la tenían configurada en ${period}; incluye a quienes la tuvieron antes y la dejaron.${rate === null ? "" : ` Lo habitual es ${formatProbability(rate)}.`}${top.length ? ` Los ${top.length} con mayor probabilidad, con su antecedente, están en «Pronóstico».` : ""}`} action={<div className="heading-links">{eligible.length > 0 && <button className="button button-secondary" onClick={() => open({ probability: "Con estimación" })}>Ver a los {number(eligible.length)} en orden de probabilidad</button>}<button className="text-link" onClick={() => onNavigate("predicciones")}>Ver los {top.length} con mayor probabilidad y el pronóstico completo <Icon name="arrow" size={16}/></button></div>}/>
          <ul className="table-notes">{!configOnly && <li>Configurar no es usar: alguien en No expuesto puede haber tenido {tool.name} configurada antes sin que sus estudiantes la usaran.</li>}<li>Haberla configurado antes va junto con una probabilidad más alta; es una relación en los datos, no quiere decir que el taller le sirva más.</li><li>La probabilidad no mide el beneficio del taller ni el mérito del profesor.</li><li>Vale si vuelve a dictar.</li></ul></>}</div></>}
  </>;
}

/** `antecedent` swaps the guidance column for the configuration background that comes with each forecast. */
/** `of` is the size of the whole filtered list when `records` is one page of it; `guidanceAbove` hides the guidance column when it is said once above the table. */
function RecordTable({ records, onProfessor, selection, onToggle, onSelectMany, showProbability = false, antecedent = false, showGroup = false, guidanceAbove = false, of, empty }: { records: TeacherToolRecord[]; onProfessor: (record: TeacherToolRecord) => void; selection?: Selection; onToggle?: (record: TeacherToolRecord) => void; onSelectMany?: (records: TeacherToolRecord[], add: boolean) => void; showProbability?: boolean; antecedent?: boolean; showGroup?: boolean; guidanceAbove?: boolean; of?: number; empty?: ReactNode }) {
  const allChecked = records.length > 0 && records.every(r => selection?.[r.professor.id]?.includes(r.tool.id));
  const someChecked = records.some(r => selection?.[r.professor.id]?.includes(r.tool.id));
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = someChecked && !allChecked; }, [someChecked, allChecked]);
  if (!records.length) return empty ?? <EmptyState title="No hay profesores con estos criterios" description="Prueba otro estado, herramienta o facultad para continuar la consulta."/>;
  const tool = records[0].tool;
  const period = formatPeriod(records[0].period);
  const habitual = habitualRate(tool.id);
  // Configuration-only tools get no guidance (decision #13); every row is the same tool.
  const guided = !antecedent && !guidanceAbove && !isConfigOnly(tool);
  const stateHeader = isConfigOnly(tool) ? `¿La tiene configurada? (${period})` : `Estado en ${tool.name} (${period})`;
  const probabilityHeader = `Probabilidad de configurarla ${nextTerm}`;
  const groupHeader = "Grupo en su semestre anterior";
  return <div className="table-wrap"><table className="data-table as-cards"><thead><tr>{selection && <th className="checkbox-cell"><label className="select-page"><input ref={checkbox} type="checkbox" aria-label={`Seleccionar a los ${records.length} de esta página para el taller de ${tool.name}`} checked={allChecked} onChange={e => onSelectMany?.(records, e.target.checked)}/><span className="select-page-text" aria-hidden="true">Marcar a los {number(records.length)} de esta página{of && of > records.length ? ` (de ${number(of)})` : ""}</span></label></th>}<th>Profesor</th><th>{stateHeader}</th>{showProbability && <th>{probabilityHeader}<span className="th-note">Si vuelve a dictar{habitual === null ? "" : ` · la rayita es lo habitual (${formatProbability(habitual)})`}{!antecedent && ` · debajo, su antecedente, que cuenta desde antes de ${SINCE}`}</span></th>}{antecedent && <th>¿La ha tenido antes en sus aulas?</th>}{showGroup && <th>{groupHeader}<span className="th-note">El de antes de {period}: describe qué configuraba, no es un nivel. Debajo, el de {period} si cambió</span></th>}{guided && <th>Qué conversar<span className="th-note">Sugerencia inicial, pendiente de aprobación</span></th>}<th><span className="sr-only">Detalle</span></th></tr></thead><tbody>{records.map(record => { const group = GROUPS.find(g => g.id === record.originGroup); const now = GROUPS.find(g => g.id === record.professor.groupByPeriod[record.period]); return <tr key={record.professor.id} data-selected={selection?.[record.professor.id]?.includes(record.tool.id) || undefined}>{selection && <td className="checkbox-cell"><label className="check-hit"><input type="checkbox" aria-label={`Seleccionar a ${record.professor.name}`} checked={selection[record.professor.id]?.includes(record.tool.id) ?? false} onChange={() => onToggle?.(record)}/></label></td>}<td data-label="Profesor"><button className="person-cell person-button" onClick={() => onProfessor(record)}><PersonIcon/><span><span className="person-name">{record.professor.name}</span><span className="person-meta">{facultyLong(record.faculty)} · dictó en {plural(record.taughtSemesters, "semestre", "semestres")} desde {SINCE}</span></span></button></td><td data-label={stateHeader}><StateBadge state={record.state} label={badgeLabel(record)}/>{!isConfigOnly(tool) && <span className="state-note">{record.condition ? caseNote[record.condition] : STATE_SHORT[record.state]}</span>}</td>{showProbability && <td data-label={probabilityHeader}><Probability value={record.probability} missing={noForecast(record)} habitual={habitual}/>{record.probability !== null && antecedent && <span className="state-note">{bandText(tool.id, probabilityBandFor(tool.id, record.probability))}</span>}{!antecedent && record.forecastReason && <span className="state-note">{record.forecastReason}</span>}</td>}{antecedent && <td className="table-reason" data-label="¿La ha tenido antes en sus aulas?">{record.forecastReason ?? "—"}</td>}{showGroup && <td className="table-reason" data-label={groupHeader}>{group ? group.name : <>—<span className="state-note">Sin semestre anterior desde {SINCE}</span></>}{now && now.id !== group?.id && <span className="state-note">Ahora ({period}): {now.name}</span>}</td>}{guided && <td className="table-reason" data-label="Qué conversar">{GUIDANCE[record.state]}</td>}<td><button className="button button-ghost table-open" aria-label={`Ver ficha de ${record.professor.name}`} onClick={() => onProfessor(record)}>Ver ficha<Icon name="arrowUp" size={15}/></button></td></tr>; })}</tbody></table></div>;
}

function ProfessorsPage(props: PageProps & { selection: Selection; onToggle: (record: TeacherToolRecord, why?: string) => void; onSelectMany: (records: TeacherToolRecord[], add: boolean, why?: string) => void; onSelection: () => void; capacity: Capacity; onCapacity: (capacity: Capacity) => void }) {
  const { filters, onFilters, selection, onToggle, onSelectMany, onProfessor, onSelection, capacity, onCapacity } = props;
  const tool = TOOLS.find(t => t.id === filters.tool)!;
  const configOnly = isConfigOnly(tool);
  const period = formatPeriod(filters.period);
  // Forecasts exist only at their origin and only for tools with a model (decision #15).
  const forecastHere = tool.forecast !== false && !offOrigin(filters.period);
  // Probability order by default when there is a forecast; rows without one go last, never as 0.
  const [sort, setSort] = useState<"code" | "probability">(forecastHere || filters.probability !== "Todas" ? "probability" : "code");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const records = getRecords(listFilters(filters));
  // A list where nobody has a probability (Adopta, Usa…) can only be in code order, and the page says so.
  const anyProbability = records.some(r => r.probability !== null);
  // Ties on the shown (rounded) probability go by code; rows without one go last, never as 0.
  const probabilityOrder = forecastHere && sort === "probability" && anyProbability;
  const sorted = useMemo(() => [...records].sort(probabilityOrder ? byProbability : byCode), [records, probabilityOrder]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const [withTies, setWithTies] = useState(false);
  useEffect(() => setPage(1), [filters, sort, pageSize]);
  useEffect(() => setWithTies(false), [filters, sort, pageSize, page]);
  // The page cut can fall inside a tie: people with the same shown probability are left out only by code.
  const lastRow = probabilityOrder ? pageRows.at(-1) : undefined;
  const lastShown = lastRow?.probability != null ? shown(lastRow.probability) : null;
  const tiedAfter = lastShown === null ? 0 : sorted.slice(currentPage * pageSize).filter(r => r.probability !== null && shown(r.probability) === lastShown).length;
  // Ties are contiguous in probability order, so the tied people are the rows right after the page.
  const visible = withTies ? sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize + tiedAfter) : pageRows;
  const total = getRecords({ period: filters.period, faculty: filters.faculty, tool: filters.tool }).length;
  const withoutBand = records.length || filters.probability === "Todas" ? 0 : getRecords({ ...listFilters(filters), probability: "Todas" }).length;
  const rate = habitualRate(tool.id);
  const validation = VALIDATION_ROWS.filter(row => row.toolId === tool.id);
  const validationPeriods = [...new Set(validation.map(row => formatPeriod(row.period)))].sort().join(" o ");
  const origin = TEXTS.forecastOrigin;
  const chosen = Object.keys(selection).length;
  const inTool = Object.values(selection).filter(tools => tools.includes(tool.id)).length;
  // Only this workshop's marks: someone marked for another workshop also shows in this list, unmarked.
  const chosenVisible = records.filter(r => selection[r.professor.id]?.includes(tool.id)).length;
  const allMarked = records.length > 0 && chosenVisible === records.length;
  const reset = () => onFilters(listPatch);
  const clearProbability = <button className="button button-secondary" onClick={() => onFilters({ probability: "Todas" })}>Quitar el filtro de probabilidad</button>;
  const group = GROUPS.find(g => g.id === filters.group);
  const summary = [
    configOnly ? filters.configured === "Todos" ? `${tool.name}: todos` : `${tool.name} configurada: ${CONFIGURED_OPTIONS[filters.configured].toLocaleLowerCase("es")}` : filters.state === "Todos" ? "Todos los estados" : filters.state === "Sin información" ? "Sin estado" : filters.state,
    period,
    filters.faculty !== "Todos" && facultyLong(filters.faculty),
    group && `grupo en su semestre anterior: ${group.name}`,
    filters.probability !== "Todas" && `probabilidad: ${filters.probability === "Con estimación" ? "con probabilidad calculada" : bandText(tool.id, filters.probability).toLocaleLowerCase("es")}`,
    filters.search && `búsqueda «${filters.search}»`,
  ].filter(Boolean).join(" · ");
  // What travels to the file as the reason for marking someone from this list.
  const why = `lista «${summary}»${probabilityOrder ? ", ordenada por probabilidad" : ""}`;
  // With one state chosen, every row has the same guidance: it is said once above the table.
  const guidanceAbove = !configOnly && filters.state !== "Todos";
  // Why this group would be invited, summed up: who had the tool before (the reasons come with the forecast).
  const history = antecedents(records);
  const quota = capacity[tool.id];
  const status = capacityStatus(inTool, quota);
  const searchEmpty = filters.search ? <EmptyState title={`Nadie con «${filters.search}» en esta lista`} description="La búsqueda mira el código del profesor (D-…), dentro de los filtros de arriba." action={<div className="heading-links"><button className="button button-secondary" onClick={() => onFilters({ search: "" })}>Borrar la búsqueda</button><button className="text-link" onClick={reset}>Limpiar filtros de la lista</button></div>}/> : undefined;
  return <><PageHeading eyebrow="03 / ELEGIR PROFESORES" title={`Elige a quién invitar al taller de ${tool.name}`} tagline="Paso 2 de 3: marca a quién invitar."/>
    <div className="workshop-band"><Icon name="book"/><p>Estás armando la lista del taller <strong>«{tool.workshop}»</strong> ({tool.name}, {period}): revisa la evidencia, elige a quién conversar y prepara una convocatoria. Para otro taller, cambia la herramienta arriba. Cada profesor aparece con su código seudónimo, no con su nombre: pasar del código a la persona está pendiente con el equipo de datos de Conecta-TE.</p></div>
    <details className="steps-box"><summary>Cómo armar la lista en 3 pasos</summary><p>1. {configOnly ? "Filtra por «¿La tiene configurada?» (por ejemplo, No)" : `Filtra por estado (por ejemplo, No expuesto: ${STATE_SHORT["No expuesto"]})`}{forecastHere ? " o por rango de probabilidad" : ""}. 2. {forecastHere ? "Ordena por probabilidad (es el orden inicial) o por código" : "Ordena por código"}. 3. Marca a quién quieres (cada casilla lo agrega a la convocatoria de este taller) y abre «Convocatoria» para revisar y descargar.</p></details>
    <section className="panel"><div className="panel-body filters-grid"><label className="field search-field"><span className="field-label">Buscar profesor</span><span className="search-input"><Icon name="search" size={17}/><input type="search" aria-label="Buscar profesor" placeholder={TEXTS.searchPlaceholder} value={filters.search} onChange={e => onFilters({ search: e.target.value })}/></span></label>
      {configOnly ? <label className="field"><span className="field-label">¿La tiene configurada en {period}?</span><select aria-label={`¿La tiene configurada en ${period}?`} value={filters.configured} onChange={e => onFilters({ configured: e.target.value as Filters["configured"] })}><option value="Todos">Todos</option>{Object.entries(CONFIGURED_OPTIONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small className="field-help">De {tool.name} solo sabemos si está configurada: no tiene estados (Adopta, Usa…).</small></label>
        : <label className="field"><span className="field-label">Estado en {tool.name} ({period})</span><select aria-label={`Estado en ${tool.name} (${period})`} value={filters.state} onChange={e => onFilters({ state: e.target.value as Filters["state"] })}><option value="Todos">Todos los estados</option>{STATES.map(s => <option key={s} value={s}>{s} · {STATE_SHORT[s]}</option>)}<option value="Sin información">Sin estado (probó y no siguió, la retomó o falta información)</option></select></label>}
      <label className="field"><span className="field-label">Grupo en su semestre anterior</span><select aria-label="Grupo en su semestre anterior" title={`El del último semestre que dictó antes de ${period}. Describe qué configuraba; no es un nivel.`} value={filters.group} onChange={e => onFilters({ group: e.target.value as Filters["group"] })}><option value="Todos">Todos los grupos</option>{GROUPS.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><small className="field-help">El de antes de {period}; «Pronóstico» usa el de {period}.</small></label>
      {forecastHere && <label className="field"><span className="field-label">Probabilidad de configurarla {nextTerm}</span><select aria-label={`Probabilidad de configurarla ${nextTerm}`} value={filters.probability} onChange={e => { const probability = e.target.value as Filters["probability"]; onFilters({ probability }); if (probability !== "Todas") setSort("probability"); }}><option value="Todas">Todos</option>{[...BANDS].reverse().map(band => <option key={band} value={band}>{bandText(tool.id, band)}</option>)}<option value="Con estimación">Con probabilidad calculada (cualquier rango)</option></select></label>}</div>
      <div className="panel-footer filter-secondary"><span className="small muted">{forecastHere ? TEXTS.relativeBands && rate !== null && <>Lo habitual en {tool.name}: {formatProbability(rate)}. De {number(validation.length)} veces en que un profesor no la tenía configurada (al llegar a {validationPeriods}), en {number(validation.filter(row => row.outcome).length)} la configuró.{filters.probability !== "Todas" && filters.probability !== "Con estimación" && ` ${trackSentence(tool.id, filters.probability)}`}</> : tool.forecast === false || !origin ? `Sin modelo para ${tool.name}: no hay probabilidad de configurarla.` : <>Solo hay probabilidad con datos de {formatPeriod(origin)}. <button className="text-link" onClick={() => onFilters({ period: origin })}>Ver {formatPeriod(origin)}</button></>}</span><button className="text-link" onClick={reset}>Limpiar filtros de la lista</button></div></section>
    <div className="list-context"><div><h2>{plural(records.length, "profesor", "profesores")} <span className="muted">· {tool.name}</span></h2><p className="small muted">Se muestran: {summary}{probabilityOrder ? " · ordenada por probabilidad de configurarla, no por necesidad ni por beneficio" : ""}{!unfiltered(listFilters(filters)) && <> · <button className="text-link" onClick={reset}>Ver a todos ({number(total)})</button></>}</p>{filters.probability !== "Todas" && (history.before > 0 || history.never > 0) && <p className="small">Su antecedente: {[history.before && `${plural(history.before, "la tuvo", "la tuvieron")} configurada en algún semestre anterior y hoy no`, history.never && `${plural(history.never, "nunca la ha tenido", "nunca la han tenido")}`].filter(Boolean).join("; ")}.</p>}</div><label className="field inline-field"><span className="field-label">Ordenar por</span><select aria-label="Ordenar por" value={probabilityOrder ? "probability" : "code"} onChange={e => setSort(e.target.value as "code" | "probability")}><option value="code">Código (A–Z, sin orden de prioridad)</option>{forecastHere && anyProbability && <option value="probability">Mayor probabilidad de configurarla primero</option>}</select>{forecastHere && !anyProbability && records.length > 0 && <small className="field-help">Aquí nadie tiene probabilidad: solo la tiene quien no tenía {tool.name} configurada en {period}{!configOnly && records.every(r => r.observation.configured) ? ", y todos estos ya la tienen" : ""}. El orden es por código.</small>}</label></div>
    {forecastHere && <details className="callout callout-compact"><summary><Icon name="info"/><span>Antes de marcar: la probabilidad no mide si el taller le servirá ni el mérito del profesor. <span className="more">Ver más</span></span></summary><p>Solo dice qué tan probable es que configure la herramienta {nextTerm}, si vuelve a dictar. «Sin estimación» quiere decir que no se pudo calcular; no es 0&nbsp;%.</p><p>La elección de fondo: quienes tienen más probabilidad están más cerca de empezar por su cuenta; quienes tienen menos pueden necesitar más el taller. Esa decisión la toma Conecta-TE según el propósito del taller; el estado, «Qué conversar» y la ficha de cada persona ayudan a decidir.</p>{validation.length > 0 && <ul>{[...BANDS].reverse().map(band => trackSentence(tool.id, band)).filter(Boolean).map(text => <li key={text}>{text}</li>)}</ul>}</details>}
    {tiedAfter > 0 && <div className="callout"><Icon name="info"/><div>{withTies ? <p>Se agregaron a esta página {tiedAfter === 1 ? "la persona" : `las ${number(tiedAfter)} personas`} con {formatProbability(lastRow!.probability!)}, la misma probabilidad que el puesto {number((currentPage - 1) * pageSize + pageRows.length)}. La casilla de arriba ahora marca a {plural(visible.length, "persona", "personas")}. Para decidir entre ellas, mira su facultad, su grupo o su ficha.</p> : <p>El último de esta página (puesto {number((currentPage - 1) * pageSize + pageRows.length)}) tiene {formatProbability(lastRow!.probability!)}, igual que {plural(tiedAfter, "persona más", "personas más")} en {tiedAfter > pageSize ? "las páginas siguientes" : "la página siguiente"}. Con la misma probabilidad, el orden es por código: antes de marcar esta página, revisa también a {tiedAfter === 1 ? "esa persona" : "esas personas"}.</p>}<button className="button button-secondary" onClick={() => setWithTies(!withTies)}>{withTies ? `Volver a ${pageSize} por página` : `Ver aquí también ${tiedAfter === 1 ? "a esa persona" : `a esas ${number(tiedAfter)} personas`}`}</button></div></div>}
    {guidanceAbove && records.length > 0 && <p className="guidance-line"><strong>Qué conversar con quienes están en {filters.state === "Sin información" ? "Sin estado" : filters.state}:</strong> {GUIDANCE[filters.state as AdoptionState]}. <span className="muted">Sugerencia inicial, igual para todos en el mismo estado; pendiente de aprobación de Conecta-TE.</span></p>}
    {/* A workshop list of more than 100 people is not realistic: bigger lists are filtered first, so «mark all» cannot add a thousand by mistake. */}
    {records.length > visible.length && records.length <= 100 && <div className="mark-all"><button className="button button-secondary" onClick={() => onSelectMany(records, !allMarked, why)}>{allMarked ? `Desmarcar a los ${number(records.length)} de esta lista` : `Marcar a los ${number(records.length)} de esta lista (todas las páginas)`}</button><span className="small muted">La casilla de la tabla marca solo los {number(visible.length)} de esta página.</span></div>}
    <section className="panel">{filters.probability !== "Todas" && !forecastHere ? tool.forecast === false ? <EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no hay probabilidad de configurarla.`} action={clearProbability}/> : <OffOrigin period={filters.period} onGo={period => onFilters({ period })} extra={clearProbability}/> : <RecordTable records={visible} of={records.length} onProfessor={onProfessor} selection={selection} onToggle={record => onToggle(record, why)} onSelectMany={(rows, add) => onSelectMany(rows, add, why)} showProbability={forecastHere} showGroup guidanceAbove={guidanceAbove} empty={searchEmpty ?? (withoutBand > 0 ? <EmptyState title="Nadie aquí tiene ese rango de probabilidad" description={`Con los otros filtros hay ${plural(withoutBand, "profesor", "profesores")}, pero ${withoutBand === 1 ? "no tiene" : "ninguno tiene"} probabilidad ${filters.probability === "Con estimación" || filters.probability === "Todas" ? "calculada" : `en el rango «${bandText(tool.id, filters.probability).toLocaleLowerCase("es")}»`}. Solo tiene probabilidad quien no tenía ${tool.name} configurada en ${period}: por ejemplo, quien está en Adopta, Usa o Apropia ya la tiene configurada, así que no tiene probabilidad de empezar.`} action={clearProbability}/> : undefined)}/>}{records.length > 0 && <div className="pagination"><span>{number((currentPage - 1) * pageSize + 1)}–{number((currentPage - 1) * pageSize + visible.length)} de {plural(records.length, "profesor", "profesores")}</span><label className="field inline-field page-size"><span className="field-label">Filas por página</span><select aria-label="Filas por página" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>{[10, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}</select></label><div><button className="button button-secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} aria-label="Página anterior">Anterior</button><span>Página {number(currentPage)} de {number(pageCount)}</span><button className="button button-secondary" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} aria-label="Página siguiente">Siguiente</button></div></div>}</section>
    <ul className="table-notes">{probabilityOrder && <li>Con la misma probabilidad mostrada, el orden es por código.</li>}{forecastHere && <li>Probabilidad de configurarla {nextTerm}: vale si vuelve a dictar.{rate === null ? "" : ` La rayita en cada barra es lo habitual en ${tool.name} (${formatProbability(rate)}).`} Su antecedente («la configuró…», «la tuvo en sus aulas…») mira la configuración desde antes de {SINCE}; los estados cuentan desde {SINCE}.</li>}{!configOnly && <li>Configurar no es usar: alguien en No expuesto puede tener {tool.name} configurada sin que sus estudiantes la usen.</li>}<li>Grupo en su semestre anterior: el del último semestre que dictó antes de {period}. Describe qué configuraba; no es un nivel. «Pronóstico» usa el grupo de {period}, el semestre del que parte el pronóstico.</li>{!configOnly && <li>Qué conversar: sugerencia inicial según el estado, igual para todos en el mismo estado; pendiente de aprobación de Conecta-TE.</li>}</ul>
    {chosen > 0 && <div className="selection-tray"><div aria-live="polite"><Icon name="check"/><strong>{plural(chosen, "profesor", "profesores")} en la convocatoria<span className="tray-tool"> · {number(inTool)} en la lista de este taller</span></strong>{status && <span className="tray-detail">Cupo de este taller: {status.text}</span>}{inTool > 0 && <span className="tray-detail">{number(chosenVisible)} {chosenVisible === 1 ? "cumple" : "cumplen"} los filtros de esta lista (en esta u otras páginas) · {number(inTool - chosenVisible)} {inTool - chosenVisible === 1 ? "no se ve" : "no se ven"} con los filtros actuales (siguen guardados)</span>}</div><div className="tray-actions"><label className="tray-quota"><span>Cupo de este taller</span><input type="number" aria-label={`Cupo del taller de ${tool.name}`} min="1" max="500" placeholder="Sin cupo" value={quota ?? ""} onChange={e => onCapacity({ ...capacity, [tool.id]: capacityValue(e.target.value) })}/></label><button className="button button-primary" onClick={onSelection}>Convocatoria ({number(chosen)}) <Icon name="arrow" size={16}/></button></div></div>}
  </>;
}

function ProfessorDialog({ record, currentTool, selection, onToggle, onClose }: { record: TeacherToolRecord; currentTool: Tool; selection: Selection; onToggle: (record: TeacherToolRecord) => void; onClose: () => void }) {
  const [toolId, setToolId] = useState(record.tool.id);
  const row = toolId === record.tool.id ? record : getRecord(record.professor.id, toolId, record.period);
  const { tool } = row;
  const period = formatPeriod(row.period);
  // The main button always acts on the workshop of the list being built; another tool viewed here gets its own button.
  const listRow = tool.id === currentTool.id ? row : getRecord(row.professor.id, currentTool.id, row.period);
  const toggleButton = (target: TeacherToolRecord, main: boolean) => { const on = selection[target.professor.id]?.includes(target.tool.id) ?? false; return <button className={`button ${on || !main ? "button-secondary" : "button-primary"} button-wrap`} onClick={() => onToggle(target)}><Icon name={on ? "close" : "plus"} size={17}/>{on ? `Quitar de la convocatoria del taller «${target.tool.workshop}»` : `Agregar a la convocatoria del taller «${target.tool.workshop}»`}</button>; };
  const typical = typicalIntensity(row);
  const nextGroups = nextGroupProbabilities(row.professor.id, row.period);
  const likely = nextGroups ? nextGroups.indexOf(Math.max(...nextGroups)) : -1;
  const configOnly = isConfigOnly(tool);
  const { effective, reach, configured, shared } = row.observation;
  const group = GROUPS.find(g => g.id === row.professor.groupByPeriod[row.period]);
  const previous = row.professor.periods.filter(p => p < row.period).at(-1);
  const origin = GROUPS.find(g => g.id === row.originGroup);
  // The data of the first semester cannot tell a first use from an older one; the note is only for whoever starts there in Adopta.
  const adoptaAtStart = !configOnly && row.history[0]?.period === PERIODS[0] && getRecord(row.professor.id, tool.id, PERIODS[0]).state === "Adopta";
  const band = row.probability === null ? null : probabilityBandFor(tool.id, row.probability);
  return <Dialog title={row.professor.name} eyebrow="FICHA DEL PROFESOR · CÓDIGO SEUDÓNIMO" onClose={onClose} wide footer={<><div className="footer-note"><span className="small muted">{TEXTS.identity}</span>{tool.id !== currentTool.id && <span className="small footer-warning">Estás viendo {tool.name}, pero la lista que armas es la de {currentTool.name}. Cada botón dice a qué taller agrega.</span>}</div>{tool.id !== currentTool.id && toggleButton(row, false)}{toggleButton(listRow, true)}</>}>
    <div className="detail-profile"><span className="avatar avatar-large" aria-hidden="true"><Icon name="person" size={26}/></span><div><p>Facultad: {facultyLong(row.faculty)} · {row.professor.department}</p><p className="muted small">Sus grupos están al final de la ficha.</p></div></div>
    <div className="toolbar"><label className="field"><span className="field-label">Herramienta de la ficha</span><select aria-label="Herramienta de la ficha" value={toolId} onChange={e => setToolId(e.target.value as ToolId)}>{TOOLS.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
    <p className="state-headline">{configOnly ? <strong>{tool.name} configurada en {period}: {configuredLabel(configured)}</strong> : <>Estado en {tool.name} ({period}): <StateBadge state={row.state} label={plainLabel(row)}/>{!row.condition && <span className="muted"> {STATE_SHORT[row.state]}</span>}</>}</p>
    <p className="detail-reason">{plainReason(row)}</p>
    <details className="detail-disclosure"><summary>Ver la regla exacta (texto técnico)</summary><p>{row.reason}{configOnly && COUNTED[tool.id] ? ` ${COUNTED[tool.id]}` : ""}</p></details>
    <h3 className="detail-section-title">Probabilidad de configurar {tool.name} {nextTerm}</h3>{tool.forecast === false ? <p className="small">Sin modelo para esta herramienta.</p> : offOrigin(row.period) ? <p className="small">Solo hay pronóstico con datos de {formatPeriod(TEXTS.forecastOrigin!)}. En {period} no hay pronóstico.</p> : <div className="detail-forecast"><Probability value={row.probability} missing={noForecast(row)} habitual={habitualRate(tool.id)}/>{band && <p className="small">{bandText(tool.id, band)}{row.forecastReason ? ` · ${row.forecastReason}` : ""}</p>}{band && trackSentence(tool.id, band) && <p className="small">{trackSentence(tool.id, band)} Es una ayuda para ordenar, no una certeza.</p>}<p className="small muted">Si vuelve a dictar. No mide si el taller le servirá ni el mérito del profesor.</p><details className="detail-disclosure"><summary>Más sobre este número</summary><p className="small muted">Es un pronóstico, no un estado: no dice si la usará con estudiantes, si llegará a Apropia ni si el taller le servirá.</p><p className="small muted">{TEXTS.estimate}</p></details></div>}
    <div className="action-card"><span className="eyebrow">TALLER Y QUÉ CONVERSAR</span><h3>Taller sugerido: {tool.workshop}</h3>{!configOnly && <p>Qué conversar: <strong>{GUIDANCE[row.state]}</strong> (porque está en {plainLabel(row)})</p>}<p className="small muted">Sugerencia inicial, pendiente de aprobación de Conecta-TE. La pertinencia del taller se confirma con el profesor y su contexto de curso. Este tablero no estima el efecto del acompañamiento.</p></div>
    <div className="evidence-grid"><div className="evidence-item"><span>¿Sus estudiantes la usaron en {period}?</span><strong>{configOnly ? "No aplica" : effective === null ? "Sin información" : effective ? "Sí" : "No"}</strong>{configOnly && <small>De {tool.name} solo sabemos si está configurada.</small>}{effective && reach !== null && <small>{formatProbability(reach)} de sus estudiantes de {period} tuvo actividad en {tool.name}. Para contar como uso basta 1 estudiante.</small>}</div><div className="evidence-item"><span>Semestres seguidos usándola</span><strong>{configOnly ? "No aplica" : row.condition === "dato" ? "Sin información" : number(row.sustainedPeriods)}</strong></div><div className="evidence-item"><span title="Valor típico = mediana del tramo activo">{configOnly ? `Contenido de ${tool.name} por aula` : `${TEXTS.unit.replace(/^./, c => c.toLocaleUpperCase("es"))} en ${tool.name} (valor típico)`}</span><strong>{typical === null ? "Sin dato" : number(typical)}</strong><small>{TEXTS.intensity(tool.threshold)}{typical !== null && " Valor típico = mediana de sus semestres seguidos de uso."}{!configOnly && TEXTS.unitHelp && ` ${TEXTS.unitHelp}`}</small></div><div className="evidence-item"><span>¿La tiene configurada en {period}?</span><strong>{configured === null ? "Sin información" : configured ? "Sí, en al menos una de sus aulas" : "No"}</strong></div></div>
    {shared && <p className="small muted">Todas sus aulas de {period} son compartidas con otros docentes: la herramienta cuenta para cada docente del aula, aunque tal vez la configuró otra persona.</p>}
    <h3 className="detail-section-title">Su recorrido en {tool.name}</h3><p className="small muted">{configOnly ? "Configurada o no, en cada semestre que dictó." : "Un estado por semestre que dictó."} Los semestres en que no dictó no aparecen.</p><div className="history-strip">{row.history.map(o => { const past = getRecord(row.professor.id, tool.id, o.period); return <div className="history-item" key={o.period}><span className="small muted">{formatPeriod(o.period)}</span><StateBadge state={past.state} label={configOnly ? `Configurada: ${configuredLabel(o.configured)}` : plainLabel(past)}/>{!SELECTABLE_PERIODS.includes(o.period) && <p>solo historia</p>}</div>; })}</div>
    {row.history.some(o => !SELECTABLE_PERIODS.includes(o.period)) && <p className="small muted">{adoptaAtStart ? `Los datos empiezan en ${SINCE}: quien ya la usaba en ${SINCE} sale en Adopta aunque la usara desde antes. ` : ""}{adoptaAtStart ? `Por eso ${EARLY.join(" y ")} se muestran` : `${EARLY.join(" y ")} se muestran`} solo como historia y no se pueden elegir arriba.</p>}
    <details className="detail-disclosure tool-chips-box"><summary>Ver su estado en las {TOOLS.length} herramientas ({period})</summary><div className="tool-chips">{TOOLS.map(t => { const other = getRecord(row.professor.id, t.id, row.period); return <button key={t.id} className="tool-chip" aria-pressed={t.id === tool.id} onClick={() => setToolId(t.id)}>{isConfigOnly(t) ? `${t.name} configurada: ${configuredLabel(other.observation.configured)}` : `${t.name}: ${plainLabel(other)}`}</button>; })}<span className="small muted">Toca una herramienta para ver su detalle en esta ficha.</span></div></details>
    <h3 className="detail-section-title">Sus grupos</h3><p className="small muted">Los grupos describen qué configura cada profesor; no son un nivel ni una nota. Cada pantalla usa uno:</p>
    <ul className="small detail-groups"><li>{origin && previous ? <>En {formatPeriod(previous)}, su semestre anterior: <strong>{origin.name}</strong>. Es el que usan «Elegir profesores» y «Grupos parecidos».</> : `En su semestre anterior: no tiene (dicta por primera vez en los datos, desde ${SINCE}).`}</li><li>En {period}: <strong>{group?.name ?? "sin grupo"}</strong>.{row.period === TEXTS.forecastOrigin ? " Es el que usa «Pronóstico», porque el pronóstico parte de este semestre." : ""}</li></ul>
    {nextGroups && <details className="detail-disclosure"><summary>Grupo probable {nextTerm}, si vuelve a dictar: {GROUPS[likely].name} ({Math.round(nextGroups[likely] * 100)}&nbsp;%)</summary><div className="bar-list is-compact next-groups">{GROUPS.map((g, i) => <div className="bar-row" key={g.id}><span className="bar-label">{g.name}</span><span className="bar-track"><span className="bar-fill" style={{ "--bar-width": `${nextGroups[i] * 100}%` } as CSSProperties}/></span><span className="bar-value">{Math.round(nextGroups[i] * 100)}&nbsp;%</span></div>)}<p className="bar-detail">Probabilidad de cada grupo si vuelve a dictar el semestre siguiente. Los grupos describen combinaciones de herramientas configuradas; no son niveles ni notas. El tablero no trae una revisión de qué tan bien acierta este grupo probable: tómalo como orientación.</p></div></details>}
  </Dialog>;
}

function SelectionDialog({ selection, period, capacity, onCapacity, note, onNote, outside, downloaded, onRemovePerson, onRemovePair, onClear, onExport, onGoList, onClose }: { selection: Selection; period: Filters["period"]; capacity: Capacity; onCapacity: (capacity: Capacity) => void; note: string; onNote: (note: string) => void; outside: number; downloaded: string; onRemovePerson: (id: string) => void; onRemovePair: (id: string, toolId: ToolId) => void; onClear: () => void; onExport: () => void; onGoList: () => void; onClose: () => void }) {
  const [clearConfirm, setClearConfirm] = useState(false);
  // By person by default: the file has one row per person in code order (decision 3.18).
  const [byWorkshop, setByWorkshop] = useState(false);
  const selected = PROFESSORS.filter(p => selection[p.id]?.length);
  const pairs = selected.reduce((n, p) => n + selection[p.id].length, 0);
  const tools = TOOLS.filter(t => selected.some(p => selection[p.id].includes(t.id)));
  const label = formatPeriod(period);
  const inWorkshop = (t: Tool) => selected.filter(p => selection[p.id].includes(t.id)).length;
  // Quotas are per workshop: each workshop with a quota gets its own status.
  const statuses = tools.map(t => ({ tool: t, status: capacityStatus(inWorkshop(t), capacity[t.id]) })).filter(row => row.status);
  const taughtNote = (p: Professor) => { const at = lastTaughtPeriod(p, period); return at === period ? "" : at ? ` · no dictó en ${label}: se exporta su estado de ${formatPeriod(at)}` : ` · no había dictado hasta ${label}`; };
  const faculty = (p: Professor) => facultyLong(facultyAt(p, period));
  const guidanceFor = (p: Professor, t: Tool) => { const at = lastTaughtPeriod(p, period); return at && !isConfigOnly(t) ? ` · Qué conversar: ${GUIDANCE[getRecord(p.id, t.id, at).state]}` : ""; };
  const probabilityOf = (p: Professor, t: Tool) => { const at = lastTaughtPeriod(p, period); return at ? getRecord(p.id, t.id, at).probability : null; };
  const forecastFor = (p: Professor, t: Tool) => { const value = probabilityOf(p, t); return value === null ? "" : ` · Probabilidad de configurarla ${nextTerm}: ${formatProbability(value)}`; };
  // Per workshop, highest probability first, so whoever to drop for the quota sits at the bottom; ties and no probability by code.
  const byChance = (t: Tool) => (a: Professor, b: Professor) => (probabilityOf(b, t) === null ? -1 : shown(probabilityOf(b, t)!)) - (probabilityOf(a, t) === null ? -1 : shown(probabilityOf(a, t)!)) || a.id.localeCompare(b.id);
  const pairButton = (p: Professor, t: Tool) => <button className="chip-remove" onClick={() => onRemovePair(p.id, t.id)} aria-label={`Quitar a ${p.name} del taller de ${t.name}`}><Icon name="close" size={11}/></button>;
  return <Dialog title="Tu próxima convocatoria" eyebrow="LISTA PARA REVISAR ANTES DE INVITAR" onClose={onClose} wide footer={<>{downloaded && <p className="download-note" role="status"><Icon name="check" size={15}/>{downloaded}</p>}{clearConfirm ? <span className="clear-confirm"><span className="small">¿Quitar a {selected.length === 1 ? "la persona" : `los ${number(selected.length)} profesores`} de la convocatoria? No se puede deshacer.</span><button className="button button-secondary" onClick={() => { onClear(); setClearConfirm(false); }}>Sí, vaciar</button><button className="text-link" onClick={() => setClearConfirm(false)}>No, mantener</button></span> : <button className="text-link" disabled={!selected.length} onClick={() => setClearConfirm(true)}>Vaciar convocatoria</button>}<button className="button button-primary" disabled={!selected.length} onClick={() => { setClearConfirm(false); onExport(); }}><Icon name="download" size={17}/> Descargar lista ({plural(selected.length, "profesor", "profesores")})</button></>}>
    <p className="muted">Revisa a quién vas a invitar y a qué taller antes de preparar la invitación. {TEXTS.selection}</p>
    <div className="selection-summary"><div><strong>{number(selected.length)}</strong><span>{selected.length === 1 ? "profesor" : "profesores"} · cada uno cuenta una vez</span></div><div><strong>{number(pairs)}</strong><span>{pairs === 1 ? "lugar en un taller" : "lugares en talleres"} · un profesor en 2 talleres ocupa 2</span></div><div><strong>{number(tools.length)}</strong><span>{tools.length === 1 ? "taller distinto" : "talleres distintos"}</span></div></div>
    {tools.length > 0 && <div className="quota-fields">{tools.map(t => <label className="field" key={t.id}><span className="field-label">Cupo del taller de {t.name} (opcional)</span><input type="number" aria-label={`Cupo del taller de ${t.name}`} min="1" max="500" placeholder="Sin cupo" value={capacity[t.id] ?? ""} onChange={e => onCapacity({ ...capacity, [t.id]: capacityValue(e.target.value) })}/></label>)}<small className="field-help">Cuántas personas caben en cada taller. Se compara con las personas marcadas para ese taller. Solo avisa: no quita a nadie.</small></div>}
    {statuses.map(({ tool: t, status }) => status!.over > 0 ? <div className="callout" key={t.id}><Icon name="info"/><p>Taller de {t.name}: {status!.text}. Puedes quitar a alguien antes de descargar: en «Por taller», cada taller va de mayor a menor probabilidad de configurarla, así que abajo quedan quienes tienen menos.</p></div> : <p className="download-note" key={t.id}><Icon name="check" size={15}/>Taller de {t.name}: {status!.over === 0 ? `cupo completo, ${number(inWorkshop(t))} de ${number(capacity[t.id]!)} lugares.` : `caben todos, ${number(inWorkshop(t))} de ${number(capacity[t.id]!)} lugares; quedan ${plural(-status!.over, "libre", "libres")}.`}</p>)}
    {outside > 0 && <p className="small muted">{plural(outside, "profesor", "profesores")} de la convocatoria {outside === 1 ? "no se ve" : "no se ven"} con los filtros actuales de la lista; igual {outside === 1 ? "se descarga" : "se descargan"}.</p>}
    {selected.length ? <>
      <div className="segmented" aria-label="Cómo ver la convocatoria"><button data-active={!byWorkshop} aria-pressed={!byWorkshop} onClick={() => setByWorkshop(false)}>Por persona</button><button data-active={byWorkshop} aria-pressed={byWorkshop} onClick={() => setByWorkshop(true)}>Por taller</button></div>
      {byWorkshop ? <>{tools.map(t => { const people = selected.filter(p => selection[p.id].includes(t.id)).sort(byChance(t)); return <section className="selection-group" key={t.id}><h3>Taller: {t.workshop} ({t.name}) · {plural(people.length, "profesor", "profesores")}</h3>{people.some(p => probabilityOf(p, t) !== null) && <p className="small muted">De mayor a menor probabilidad de configurarla {nextTerm}; quienes no tienen probabilidad van al final.</p>}<div className="selection-list">{people.map(p => { const others = TOOLS.filter(o => o.id !== t.id && selection[p.id].includes(o.id)); return <div className="selection-item" key={p.id}><PersonIcon/><div><strong>{p.name}</strong><p className="small muted">{faculty(p)} · {selectionState(p.id, t.id, period)}{guidanceFor(p, t)}{forecastFor(p, t)}{others.length ? ` · También en: ${others.map(o => o.name).join(", ")}` : ""}{taughtNote(p)}</p></div>{pairButton(p, t)}</div>; })}</div></section>; })}<p className="small muted">El archivo tiene una fila por profesor, con todos sus talleres, en orden de código.</p></>
        : <><p className="small muted">En orden de código, como en el archivo descargado.</p><div className="selection-list">{selected.map(p => { const mine = TOOLS.filter(t => selection[p.id].includes(t.id)); return <div className="selection-item" key={p.id}><PersonIcon/><div><strong>{p.name}</strong><p className="small muted">{faculty(p)}{taughtNote(p)}</p><div className="selected-tools">{mine.map(t => <span key={t.id}><strong>{t.name}</strong> · taller «{t.workshop}» · {selectionState(p.id, t.id, period)}{guidanceFor(p, t)}{forecastFor(p, t)}{mine.length > 1 && pairButton(p, t)}</span>)}</div></div><button className="button button-ghost" onClick={() => onRemovePerson(p.id)} aria-label={`Quitar a ${p.name} de toda la convocatoria`}><Icon name="close" size={15}/><span className="remove-label">{mine.length > 1 ? "Quitar de toda la convocatoria" : "Quitar"}</span></button></div>; })}</div>{selected.some(p => selection[p.id].length > 1) && <p className="small muted">La × junto a un taller quita a la persona solo de ese taller; «Quitar de toda la convocatoria» la quita de todos.</p>}</>}
      {selected.some(p => tools.some(t => selection[p.id].includes(t.id) && forecastFor(p, t))) && <p className="small muted">La probabilidad vale si vuelve a dictar y no mide si el taller le servirá ni el mérito del profesor; en el archivo va con este mismo aviso.</p>}
    </> : <EmptyState title="Aún no hay nadie en la convocatoria" description="Elige arriba una herramienta (cada una tiene su taller), ve a «Elegir profesores» y marca a quién quieres." action={<button className="button button-secondary" onClick={onGoList}>Ir a «Elegir profesores»</button>}/>}
    {selected.length > 0 && <label className="field note-field"><span className="field-label">Nota para el archivo (opcional)</span><input type="text" aria-label="Nota para el archivo (opcional)" maxLength={300} placeholder="Por ejemplo: desempate por facultad" value={note} onChange={e => onNote(e.target.value)}/><small className="field-help">Va en la columna «Nota» de cada fila, para que el motivo de la elección viaje con la lista. El archivo ya trae, por persona, la lista desde la que la marcaste.</small></label>}
    <p className="small"><strong>Antes de descargar:</strong> descargar no envía invitaciones, y esta lista se guarda solo en este navegador.</p>
    <details className="detail-disclosure"><summary>Qué trae el archivo y otros detalles</summary><ul className="small muted"><li>El archivo trae a todas las personas de la convocatoria, también a las que no se ven con los filtros actuales.</li><li>El estado (o, en herramientas de solo configuración, si la tiene configurada) es el de {label}. Si alguien no dictó en {label}, sale con el de su último semestre dictado y ese semestre al lado.</li><li>Esta lista se guarda solo en este navegador de este computador: otra persona del equipo no la ve y se pierde si se borran los datos del navegador. Para guardarla o compartirla, descárgala.</li><li>Para que el porqué de cada invitación viaje con la lista, el archivo trae, por herramienta, el estado, por qué está en ese estado, «Qué conversar», la probabilidad de configurarla {nextTerm} con su aviso y su antecedente, y en «Criterio» la lista (filtros) desde la que marcaste a cada persona en esta sesión. No trae el grupo: ese se ve en el tablero.</li><li>«Fuente» dice cuándo se generaron los datos y cuándo se descargó la lista.</li><li>«Semestre consultado» ({label}) es el semestre de los datos{TARGET ? `; el taller sería para ${formatPeriod(TARGET)}` : ""}.</li><li>Las columnas «Profesor (código seudónimo)» y «Código» traen hoy el mismo código: la primera queda para el nombre cuando se pueda pasar del código a la persona.</li><li>Descargar no envía invitaciones.</li></ul></details>
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
      <details className="guide-tools" open={section === "taller"}><summary>Ver las {TOOLS.length} herramientas: qué es cada una, su taller y qué dato hay</summary><div className="table-wrap"><table className="data-table as-cards guide-table"><thead><tr><th>Herramienta</th><th>Qué es</th><th>Taller sugerido</th><th>Qué dato hay</th><th>Corte de Apropia ({TEXTS.unit})</th><th>Pronóstico</th></tr></thead><tbody>{TOOLS.map(t => { const since = firstData.get(t.id); return <tr key={t.id}><td className="guide-tool">{t.name}</td><td className="table-reason" data-label="Qué es">{t.description}</td><td className="table-reason" data-label="Taller sugerido">{t.workshop}</td><td className="table-reason" data-label="Qué dato hay">{isConfigOnly(t) ? "Solo configuración" : "Uso con estudiantes"}{since && since > PERIODS[0] ? ` (datos desde ${formatPeriod(since)})` : ""}</td><td data-label={`Corte de Apropia (${TEXTS.unit})`}>{t.threshold === null ? "—" : `más de ${number(t.threshold)}`}</td><td data-label="Pronóstico">{t.forecast === false ? "No" : "Sí"}</td></tr>; })}</tbody></table></div></details>{TEXTS.unitHelp && <p className="small muted">{TEXTS.unitHelp}</p>}</section>
    <section>{heading("estados")}<p>Cada profesor tiene un estado distinto en cada herramienta; por ejemplo, Usa en Contenidos y No expuesto en Rúbricas. Los 5 estados vienen del marco del proyecto, inspirado en DigCompEdu (un marco europeo de competencias digitales de los docentes). Aquí solo miden qué herramientas se usan con estudiantes y cuánto, no la competencia del profesor.</p>
      <div className="method-states">{STATES.map(s => <div key={s}><StateBadge state={s}/><p>{STATE_PLAIN[s]} <strong>Qué conversar:</strong> {GUIDANCE[s]}.</p></div>)}{conditionsShown.map(c => <div key={c}><StateBadge state="Sin información" label={c === "configuracion" ? "Configurada: sí / no / sin dato" : CASE_LABELS[c]}/><p>{conditionDescriptions[c]}{c !== "configuracion" && <> <strong>Qué conversar:</strong> {GUIDANCE["Sin información"]}.</>}</p></div>)}</div>
      <details><summary>Ver la definición del marco de cada estado y los nombres técnicos</summary><ul className="small muted">{STATES.map(s => <li key={s}>{s}: {stateDescriptions[s]}</li>)}{conditionsShown.map(c => <li key={c}>{c === "configuracion" ? "Configurada" : CASE_LABELS[c]}: nombre técnico «{CONDITION_LABELS[c]}».</li>)}</ul></details>
      <p>{conditionsShown.map(c => `«${c === "configuracion" ? "Configurada" : CASE_LABELS[c]}»`).join(", ").replace(/, ([^,]*)$/, " y $1")} no son estados: no entran en los porcentajes, pero cada caso se cuenta y se explica aparte. No se cuentan como Abandona.{EARLY.length > 0 && ` Los estados se consultan desde ${formatPeriod(SELECTABLE_PERIODS[0])}; ${EARLY.join(" y ")} quedan solo como historia.`}</p></section>
    <section>{heading("configurada")}<p>{CONFIG_HELP}</p><p>Configuración y uso con estudiantes son evidencias distintas. El pronóstico estima empezar a configurar; no predice los estados.</p>{SHARED_KNOWN && <p>Cuando varios docentes dictan la misma aula, la herramienta cuenta para cada uno, aunque tal vez la configuró una sola persona. La ficha lo avisa cuando todas las aulas del profesor en ese semestre son compartidas.</p>}{Object.keys(COUNTED).length > 0 && <ul>{TOOLS.filter(t => COUNTED[t.id]).map(t => <li key={t.id}><strong>{t.name}:</strong> {COUNTED[t.id]}</li>)}</ul>}</section>
    <section>{heading("reglas")}<details open><summary>{TEXTS.rulesTitle}</summary><ul>{TEXTS.plainRules(tool).map(text => <li key={text}>{text}</li>)}</ul>{USE_TOOLS.length < TOOLS.length && <p>{TOOLS.filter(isConfigOnly).map(t => t.name).join(", ").replace(/, ([^,]*)$/, " y $1")}: solo hay datos de configuración, así que no reciben estado.</p>}<details><summary>Ver detalle técnico</summary>{TEXTS.rules.map(text => <p key={text}>{text}</p>)}<p>Valor típico = mediana del tramo activo (sus semestres seguidos de uso). Corte = percentil 75.</p><p>{conditionsShown.map(c => `«${CONDITION_LABELS[c]}»`).join(", ").replace(/, ([^,]*)$/, " y $1")} no son etapas del marco: quedan fuera de los porcentajes, cada caso con su número y su explicación. No se convierten automáticamente en abandono.</p></details></details></section>
    <section>{heading("grupos")}<div className="method-states guide-groups">{GROUPS.map(g => <div key={g.id}><strong>{g.name}</strong><p>{g.description}</p></div>)}</div><p>{TEXTS.groupsOrigin} Son una descripción: no son un nivel ni una nota. «Grupo nominal» quiere decir eso: el grupo es un nombre, no un orden; {GROUPS[0]?.id} a {GROUPS.at(-1)?.id} no va de menos a más.</p><ul><li>Grupo en un semestre: el del semestre que miras (ficha).</li><li>Grupo en su semestre anterior: el del último semestre que dictó antes (Elegir profesores y Grupos parecidos). Se usa para comparar porque el grupo de un semestre se arma con lo que configuró ese mismo semestre.</li>{TEXTS.forecastOrigin && <li>Grupo en {formatPeriod(TEXTS.forecastOrigin)} (Pronóstico): el del semestre del que parte el pronóstico.</li>}<li>Grupo probable {nextTerm}: pronóstico que aparece en la ficha.</li></ul><p>Ojo al comparar: los grupos se armaron mirando qué herramientas configura cada profesor. Por eso, parte de las diferencias entre grupos viene de cómo se armaron y no es un hallazgo nuevo. Los grupos describen qué combinación de herramientas configura cada profesor. No son una escala de calidad ni niveles de competencia.</p></section>
    <section>{heading("pronostico")}<p>Qué estima: la probabilidad de que un profesor configure la herramienta en al menos un aula la próxima vez que dicte{TARGET ? ` (${formatPeriod(TARGET)})` : ""}, para quienes no la tenían configurada. No predice los estados (Adopta, Usa, Apropia o Abandona) ni el beneficio de un taller.</p><p>{TEXTS.modelPlain}</p>{TEXTS.relativeBands && <p>Lo habitual: la parte de los casos revisados que configuró la herramienta; es la referencia de los 3 rangos: más del doble de lo habitual, entre lo habitual y el doble, y menos que lo habitual. Los rangos sirven para explorar; no son niveles de adopción ni de calidad docente.</p>}<p>{TEXTS.estimates}</p>{TEXTS.review && <p>{TEXTS.review}</p>}<details><summary>Ver detalle técnico</summary><p>{MODEL_TERMS}</p><p>{TEXTS.model}</p></details></section>
    <section>{heading("tablero")}<p>{TEXTS.method} No mide calidad docente ni aprendizaje, ni demuestra que un taller cause un cambio (efecto causal).</p><details><summary>Cómo se diseñó este tablero</summary><p>Las barras sirven para comparar cantidades; las tablas, para revisar y elegir personas. Los grupos son combinaciones de herramientas y no tienen orden de mérito.</p><p>Seguimos el modelo de Tamara Munzner (autora de un método para diseñar visualizaciones): entender la decisión de Conecta-TE, definir datos y tareas, elegir representaciones e interacciones y comprobar su consistencia. Las barras facilitan comparar cantidades; las tablas permiten revisar y seleccionar personas. Los grupos de uso son categorías descriptivas y no tienen orden de mérito.</p><p>DIDACTA, la firma del menú: su significado está pendiente de confirmar con el equipo.</p></details></section>
  </Dialog>;
}
