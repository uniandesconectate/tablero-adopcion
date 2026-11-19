import { FACULTIES, MIN_PROFESSORS, OBSERVATIONS, PERIODS, PROFESSORS, SELECTABLE_PERIODS, TEXTS, TOOLS, VALIDATION_ROWS, onSource, probabilityBand, startProbability, startReason } from "./data";
import { CASE_LABELS, CONDITION_LABELS, type AdoptionState, type Cause, type Condition, type Filters, type GroupId, type Observation, type PeriodId, type ProbabilityBand, type Professor, type Selection, type TeacherToolRecord, type Tool, type ToolId } from "./types";

export function formatPeriod(period: string): string {
  const match = /^(\d{4})(10|20)$/.exec(period);
  return match ? `${match[1]}-${match[2] === "10" ? "1" : "2"}` : period;
}

/** Colombian digits: «2.249», «184,6». */
export const number = (n: number) => new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1, useGrouping: "always" }).format(n);
export const plural = (n: number, one: string, many: string) => `${number(n)} ${n === 1 ? one : many}`;

const periodIndex = (period: PeriodId) => PERIODS.indexOf(period);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const semesters = (n: number) => n === 1 ? "1 semestre" : `${n} semestres`;

/** `taught` are the semesters the professor taught: completeness and runs skip semesters without teaching. */
export function classify(history: Observation[], tool: Tool, taught: readonly PeriodId[] = PERIODS): { state: AdoptionState; condition: Condition | null; reason: string; cause: Cause; sustainedPeriods: number; firstEffectivePeriod: PeriodId | null } {
  const all = history.filter(row => row.toolId === tool.id).sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  const latest = all.at(-1);
  // A semester without effective-use data is skipped like one without teaching: it neither cuts nor counts a run.
  const missing = new Set(all.filter(row => row.effective === null).map(row => row.period));
  const rows = all.filter(row => row.effective !== null);
  const firstEffectivePeriod = rows.find(row => row.effective === true)?.period ?? null;
  let sustainedPeriods = 0;
  if (latest?.effective !== null) for (let i = rows.length - 1; i >= 0 && rows[i].effective === true; i--) sustainedPeriods++;
  const skipped = !missing.size ? "" : missing.size === 1 ? " Un semestre no tiene dato de uso efectivo: no corta ni cuenta en su historia." : ` ${missing.size} semestres no tienen dato de uso efectivo: no cortan ni cuentan en su historia.`;
  const result = (state: AdoptionState, reason: string, cause: Cause, condition: Condition | null = null) => ({ state, condition, reason: condition ? reason : reason + skipped, cause, sustainedPeriods, firstEffectivePeriod });
  if (tool.evidence === "configuracion") return result("Sin información", "Para esta herramienta solo hay datos de configuración: no se asigna un estado del marco.", "configuracion", "configuracion");
  if (!latest) return result("Sin información", "No hay observaciones para esta herramienta.", "sin-observaciones", "dato");
  if (latest.effective === null) return result("Sin información", "Falta el dato de uso efectivo de este semestre, así que no se le asigna un estado.", "falta-dato", "dato");
  const expected = taught.filter(period => periodIndex(period) <= periodIndex(latest.period) && !missing.has(period));
  const duplicatePeriods = new Set(all.map(row => row.period)).size !== all.length;
  const fullHistory = expected.length === rows.length && expected.every((period, i) => rows[i].period === period);
  if (duplicatePeriods || !fullHistory) {
    return result("Sin información", "La historia tiene observaciones faltantes o no comparables; no se interpreta la ausencia como falta de uso.", "historia", "dato");
  }
  // Effective use is an independent field, never inferred from configuration.
  if (rows.some(row => row.effective === true && row.configured !== true)) {
    return result("Sin información", "La evidencia de configuración y uso efectivo es inconsistente.", "inconsistente", "dato");
  }
  if (!firstEffectivePeriod) {
    const configured = rows.filter(row => row.configured === true).length;
    return result("No expuesto", TEXTS.neverExposed(rows.length, formatPeriod(PERIODS[0])) + (configured ? ` La tuvo configurada en ${semesters(configured)}, sin actividad de estudiantes.` : ""), "no-expuesto");
  }
  if (latest.effective === true) {
    const earlierUse = rows.slice(0, -1).some(row => row.effective === true);
    if (!earlierUse) return result("Adopta", "Primer uso efectivo registrado; todavía no se confirma su continuidad.", "adopta");
    if (sustainedPeriods < 2) return result("Sin información", "Retomó el uso después de una interrupción; este tablero no asigna una etapa a la reactivación.", "retomo", "regla");
    const currentRun = rows.slice(-sustainedPeriods);
    const completeIntensity = currentRun.every(row => row.intensity !== null && Number.isFinite(row.intensity));
    if (completeIntensity && tool.threshold !== null && median(currentRun.map(row => row.intensity!)) > tool.threshold) {
      return result("Apropia", `Uso efectivo durante ${sustainedPeriods} periodos consecutivos e intensidad mediana superior al corte de apropiación (${tool.threshold}).`, "apropia");
    }
    return result("Usa", `Uso efectivo durante ${sustainedPeriods} periodos consecutivos${completeIntensity ? "; la mediana no supera el corte de apropiación." : "; falta intensidad comparable para evaluar apropiación."}`, "usa");
  }
  let maximumRun = 0;
  let run = 0;
  for (const row of rows) {
    run = row.effective === true ? run + 1 : 0;
    maximumRun = Math.max(maximumRun, run);
  }
  if (maximumRun >= 2) return result("Abandona", "Se observó uso efectivo sostenido y posteriormente dejó de registrarse; no implica abandono definitivo.", "abandona");
  return result("Sin información", "Hubo un ensayo aislado que no continuó; no cumple la condición de uso sostenido previo para Abandona.", "ensayo", "regla");
}

/** Last semester the professor taught up to and including `period`, or null. */
export function lastTaughtPeriod(professor: Professor, period: PeriodId): PeriodId | null {
  return professor.periods.filter(p => periodIndex(p) <= periodIndex(period)).at(-1) ?? null;
}
/** Group in the professor's previous taught semester: where a teacher comes from when `period` starts. */
export function originGroup(professor: Professor, period: PeriodId): GroupId | null {
  const previous = professor.periods.filter(p => periodIndex(p) < periodIndex(period)).at(-1);
  return previous ? professor.groupByPeriod[previous] ?? null : null;
}
/** Faculty in `period`, or in the last semester taught before it. */
export function facultyAt(professor: Professor, period: PeriodId): string {
  const at = lastTaughtPeriod(professor, period);
  return (at && professor.facultyByPeriod[at]) ?? professor.faculty;
}

let observationIndex = new Map<string, Observation[]>();
let recordCache = new Map<string, TeacherToolRecord>();
let professorIndex = new Map<string, Professor>();
let toolIndex = new Map<ToolId, Tool>();
let professorsByPeriod = new Map<PeriodId, Professor[]>();
let habitual = new Map<ToolId, number | null>();
/** Semester and tool every view opens with: the forecast origin (else the last semester) and Rúbricas when the file has it. */
export let DEFAULT_PERIOD: PeriodId = "";
export let DEFAULT_TOOL: ToolId = "";
// Indexes of the open file, rebuilt each time a file is loaded.
onSource(() => {
  observationIndex = new Map();
  for (const row of OBSERVATIONS) {
    const key = `${row.professorId}:${row.toolId}`;
    const rows = observationIndex.get(key) ?? [];
    rows.push(row);
    observationIndex.set(key, rows);
  }
  recordCache = new Map();
  professorIndex = new Map(PROFESSORS.map(professor => [professor.id, professor]));
  toolIndex = new Map(TOOLS.map(tool => [tool.id, tool]));
  professorsByPeriod = new Map(PERIODS.map(period => [period, PROFESSORS.filter(professor => professor.periods.includes(period))]));
  habitual = new Map(TOOLS.map(tool => {
    const rows = VALIDATION_ROWS.filter(row => row.toolId === tool.id);
    return [tool.id, rows.length ? rows.filter(row => row.outcome).length / rows.length : null];
  }));
  DEFAULT_PERIOD = TEXTS.forecastOrigin ?? SELECTABLE_PERIODS.at(-1)!;
  DEFAULT_TOOL = toolIndex.has("rubricas") ? "rubricas" : TOOLS[0].id;
});

export function getRecord(professorId: string, toolId: ToolId, period: PeriodId): TeacherToolRecord {
  const key = `${professorId}:${toolId}:${period}`;
  const existing = recordCache.get(key);
  if (existing) return existing;
  const professor = professorIndex.get(professorId);
  const tool = toolIndex.get(toolId);
  if (!professor || !tool || !PERIODS.includes(period)) throw new Error("Profesor, herramienta o periodo desconocido.");
  const history = (observationIndex.get(`${professorId}:${toolId}`) ?? []).filter(row => periodIndex(row.period) <= periodIndex(period));
  const observation = history.find(row => row.period === period);
  if (!observation) throw new Error("No existe observación para el periodo solicitado.");
  const classification = classify(history, tool, professor.periods);
  const previousHistory = history.filter(row => periodIndex(row.period) < periodIndex(period));
  const previousState = previousHistory.length ? classify(previousHistory, tool, professor.periods).state : null;
  const record: TeacherToolRecord = {
    professor, tool, period, observation, history, previousState, ...classification,
    probability: startProbability(professor, tool, history),
    forecastReason: startReason(professor, tool, history),
    taughtSemesters: professor.periods.filter(p => periodIndex(p) <= periodIndex(period)).length,
    faculty: facultyAt(professor, period),
    originGroup: originGroup(professor, period),
  };
  recordCache.set(key, record);
  return record;
}

/** The state, or the case behind "Sin información" («Regla pendiente para este caso», …). */
export const stateLabel = (record: Pick<TeacherToolRecord, "state" | "condition">): string => record.condition ? CONDITION_LABELS[record.condition] : record.state;
/** Same, with the plain case names shown on screen («Sin estado aún», …). */
export const plainLabel = (record: Pick<TeacherToolRecord, "state" | "condition">): string => record.condition ? CASE_LABELS[record.condition] : record.state;
export const facultyName = (code: string): string => TEXTS.facultyNames[code] ?? code;
/** «Administración (AD)», or the value as it comes when the source has no name for it. */
export const facultyLong = (code: string): string => TEXTS.facultyNames[code] ? `${TEXTS.facultyNames[code]} (${code})` : code;
/** What to talk about in each state: an initial suggestion, the same for everyone in that state. */
export const GUIDANCE: Record<AdoptionState, string> = { "No expuesto": "Explorar un primer acercamiento", Adopta: "Acompañar la continuidad", Usa: "Explorar una profundización", Apropia: "Revisar necesidades específicas", Abandona: "Conversar sobre la interrupción", "Sin información": "Completar el contexto: conversar para entender su caso" };
// What "configurada" counts for each external tool (decision #4a), as k5_markov.py reads it.
// shortcut: texts copied from the exporter's sources; move them to the contract if those sources change.
export const COUNTED: Partial<Record<ToolId, string>> = {
  lockdown: "Cuenta si algún cuestionario de sus aulas pide LockDown.",
  turnitin: "Cuenta si algún buzón de tareas de sus cursos tiene Turnitin, que puede venir de la plantilla del curso.",
  padlet: "Cuenta si aparece en alguna de sus aulas por cualquier vía, por ejemplo un enlace en un tema.",
  genially: "Cuenta si aparece en alguna de sus aulas por cualquier vía, por ejemplo un enlace en un tema.",
  feedbackfruits: "Cuenta si aparece en alguna de sus aulas por cualquier vía, por ejemplo un enlace en un tema.",
  voicethread: "Cuenta si aparece en alguna de sus aulas por cualquier vía. Solo se ve por enlace rápido y se reconoce de forma indirecta, así que la cifra puede quedarse corta.",
};
export const configuredLabel = (configured: boolean | null) => configured === null ? "sin dato" : configured ? "sí" : "no";
export const configuredKey = (configured: boolean | null) => configured === null ? "sin-dato" : configured ? "si" : "no";
/** Rows of the current run of effective use; semesters without data are skipped, as in classify(). */
export const activeRun = (record: TeacherToolRecord): Observation[] => record.sustainedPeriods ? record.history.filter(row => row.effective !== null).slice(-record.sustainedPeriods) : [];
/** Median intensity of the current run (the «valor típico»), or null without data. */
export function typicalIntensity(record: TeacherToolRecord): number | null {
  const values = activeRun(record).map(row => row.intensity).filter((v): v is number => v !== null && Number.isFinite(v));
  return values.length ? median(values) : null;
}

/** The record's reason in plain words; `record.reason` keeps the exact rule. */
export function plainReason(record: TeacherToolRecord): string {
  const { tool, sustainedPeriods: run } = record;
  const since = formatPeriod(PERIODS[0]);
  const period = formatPeriod(record.period);
  const known = record.history.filter(row => row.effective !== null);
  const typical = typicalIntensity(record);
  const complete = activeRun(record).every(row => row.intensity !== null && Number.isFinite(row.intensity));
  const cut = tool.threshold === null ? "" : number(tool.threshold);
  const configuredBefore = known.filter(row => row.configured === true).length;
  const missing = record.history.filter(row => row.effective === null).length;
  const skipped = record.condition || !missing ? "" : missing === 1 ? " Un semestre no tiene dato de uso con estudiantes: no corta ni suma en su historia." : ` ${missing} semestres no tienen dato de uso con estudiantes: no cortan ni suman en su historia.`;
  const runText = `La ha usado con estudiantes ${plural(run, "semestre seguido", "semestres seguidos")}`;
  const text: Record<Cause, string> = {
    configuracion: `De ${tool.name} solo sabemos si está configurada, así que no recibe estado.${COUNTED[tool.id] ? ` ${COUNTED[tool.id]}` : ""}`,
    "sin-observaciones": "No hay datos de esta herramienta para este profesor.",
    "falta-dato": `Falta el dato de uso con estudiantes de ${period}, así que no tiene estado.`,
    historia: "Su historia tiene semestres sin dato o que no se pueden comparar; no tomamos la falta de dato como falta de uso.",
    inconsistente: "Los datos de configuración y de uso no coinciden.",
    "no-expuesto": `Ninguno de sus estudiantes la ha usado ${known.length === 1 ? `en ${period}, el único semestre con datos que ha dictado desde ${since}` : `en los ${number(known.length)} semestres que dictó desde ${since}`}.${configuredBefore ? ` La tuvo configurada en ${plural(configuredBefore, "semestre", "semestres")} desde ${since}, sin actividad de estudiantes (contado desde ${since}, como los estados; el antecedente de la probabilidad puede contar semestres anteriores).` : ""}`,
    adopta: `${period} es el primer semestre en que sus estudiantes la usan desde ${since}; aún no se sabe si seguirá.`,
    retomo: "Volvió a usarla después de dejarla. El tablero todavía no tiene un estado para quien la retoma.",
    apropia: `${runText} y en un semestre típico pone ${number(typical ?? 0)} ${TEXTS.unit}, más que el corte de Apropia (${cut}).`,
    usa: complete && typical !== null ? `${runText}. En un semestre típico pone ${number(typical)} ${TEXTS.unit}; para Apropia hacen falta más de ${cut}, así que queda en Usa.` : `${runText}; falta un dato de intensidad comparable para saber si llega a Apropia.`,
    abandona: "La usó con estudiantes 2 o más semestres seguidos y después dejó de usarla. No quiere decir que la dejó para siempre.",
    ensayo: `La usó con estudiantes, pero nunca 2 semestres seguidos, y en ${period} no la usa. No cuenta como Abandona, que pide haberla usado 2 semestres seguidos.`,
  };
  return text[record.cause] + skipped;
}

/** «n %», or «n de N · pocos profesores» with no ratio (so no bar) when the base is under the source's minimum. */
export function share(n: number, total: number): { ratio: number | null; text: string } {
  // A no-break space keeps «20 %» on one line.
  if (total >= MIN_PROFESSORS) return { ratio: n / total, text: `${Math.round(n / total * 100)}\u00a0%` };
  return { ratio: null, text: total ? `${number(n)} de ${number(total)} · pocos profesores` : "—" };
}

/** Share of the tool's validation cases that started to configure it: the reference for its bands. */
export const habitualRate = (toolId: ToolId): number | null => habitual.get(toolId) ?? null;
// One decimal under 10 %; bands and the list order use this same rounded number.
export const shown = (p: number) => p < 0.001 ? 0 : Math.round(p * 1000) < 100 ? Math.round(p * 1000) / 1000 : Math.round(p * 100) / 100;
export const byCode = (a: TeacherToolRecord, b: TeacherToolRecord) => a.professor.id.localeCompare(b.professor.id);
/** Highest shown probability first, ties by code, rows without one last (never as 0): the same order in every list. */
export const byProbability = (a: TeacherToolRecord, b: TeacherToolRecord) => (b.probability === null ? -1 : shown(b.probability)) - (a.probability === null ? -1 : shown(a.probability)) || byCode(a, b);
/** «42 %», «4,2 %» under 10 % and «menos de 0,1 %» under 0.1 %. */
export function formatProbability(p: number): string {
  if (p < 0.001) return "menos de 0,1\u00a0%";
  const value = shown(p);
  const digits = value < 0.1 ? 1 : 0;
  return `${(value * 100).toLocaleString("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits })}\u00a0%`;
}
/** What happened in the review to the cases of `band`: how many there were and how many configured the tool. */
export function bandTrackRecord(toolId: ToolId, band: ProbabilityBand): { cases: number; started: number } {
  const rows = VALIDATION_ROWS.filter(row => row.toolId === toolId && probabilityBandFor(toolId, row.probability) === band);
  return { cases: rows.length, started: rows.filter(row => row.outcome).length };
}
/** How many of `records` had the tool configured in an earlier semester; the reasons come from the export's fixed sentences. */
export function antecedents(records: TeacherToolRecord[]): { before: number; never: number } {
  // shortcut: reads the exporter's wording («No la ha…» = never had it); move it to a field of the contract if the sentences change.
  const known = records.filter(record => record.forecastReason);
  const never = known.filter(record => /^No /.test(record.forecastReason!)).length;
  return { before: known.length - never, never };
}
export function probabilityBandFor(toolId: ToolId, p: number): ProbabilityBand {
  const rate = habitualRate(toolId);
  return probabilityBand(shown(p), rate === null ? null : shown(rate));
}
/** The upper band cut exactly as probabilityBandFor applies it: «50 %», or «10,4 %» when it needs the decimal. */
export function formatDoubleRate(toolId: ToolId): string {
  const cut = 2 * shown(habitualRate(toolId) ?? 0);
  return `${(cut * 100).toLocaleString("es-CO", { minimumFractionDigits: cut < 0.1 ? 1 : 0, maximumFractionDigits: 1 })}\u00a0%`;
}

const normalized = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

export function getRecords(filters: Partial<Filters> = {}): TeacherToolRecord[] {
  const { period = DEFAULT_PERIOD, tool = DEFAULT_TOOL, faculty = "Todos", group = "Todos", state = "Todos", probability = "Todas", search = "", configured = "Todos" } = filters;
  const query = normalized(search.trim());
  return (professorsByPeriod.get(period) ?? []).map(professor => getRecord(professor.id, tool, period)).filter(record => {
    if (faculty !== "Todos" && record.faculty !== faculty) return false;
    if (group !== "Todos" && record.originGroup !== group) return false;
    if (state !== "Todos" && record.state !== state) return false;
    if (configured !== "Todos" && configured !== configuredKey(record.observation.configured)) return false;
    // Name and code only: real names are the code, and the contract type must not match a search.
    if (query && !normalized(`${record.professor.name} ${record.professor.id}`).includes(query)) return false;
    if (probability !== "Todas") {
      if (record.probability === null) return false;
      if (probability !== "Con estimación" && probability !== probabilityBandFor(record.tool.id, record.probability)) return false;
    }
    return true;
  });
}

export function summarize(records: TeacherToolRecord[]) {
  const states: Record<AdoptionState, number> = { "No expuesto": 0, Adopta: 0, Usa: 0, Apropia: 0, Abandona: 0, "Sin información": 0 };
  const conditions: Record<Condition, number> = { regla: 0, dato: 0, configuracion: 0 };
  for (const record of records) {
    states[record.state]++;
    if (record.condition) conditions[record.condition]++;
  }
  const measurable = records.filter(record => record.observation.configured !== null);
  const eligible = records.filter(record => record.probability !== null);
  return { total: records.length, uniqueProfessors: new Set(records.map(record => record.professor.id)).size, measurable: measurable.length, configured: measurable.filter(record => record.observation.configured).length, eligible: eligible.length, expectedStarts: eligible.reduce((sum, record) => sum + record.probability!, 0), states, conditions };
}

/** State text for the call list; a professor who did not teach in `period` keeps the last taught semester's, named next to it. */
export function selectionState(professorId: string, toolId: ToolId, period: PeriodId): string {
  const professor = professorIndex.get(professorId);
  if (!professor) throw new Error("Profesor desconocido.");
  const at = lastTaughtPeriod(professor, period);
  if (!at) return `no había dictado hasta ${formatPeriod(period)}`;
  const record = getRecord(professorId, toolId, at);
  if (record.tool.evidence === "configuracion") return `configurada en ${formatPeriod(at)}: ${configuredLabel(record.observation.configured)}`;
  return at === period ? plainLabel(record) : `${plainLabel(record)} (último semestre dictado: ${formatPeriod(at)})`;
}

/** RFC-style quoted cells, semicolon separator, UTF-8 BOM and spreadsheet safety. */
function csvCell(value: string): string {
  // A quoted CSV cell can still execute as a spreadsheet formula after import.
  const safe = /^[\s﻿]*[=+@-]/u.test(value) || /^[\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Probability for the file: the number with its band, or why there is none (never 0). */
function forecastText(record: TeacherToolRecord): string {
  if (record.probability !== null) return `${formatProbability(record.probability)} (${TEXTS.bands[probabilityBandFor(record.tool.id, record.probability)].toLocaleLowerCase("es")})`;
  if (record.tool.forecast === false) return "sin pronóstico para esta herramienta";
  if (TEXTS.forecastOrigin && record.period !== TEXTS.forecastOrigin) return `solo hay pronóstico con datos de ${formatPeriod(TEXTS.forecastOrigin)}`;
  return record.observation.configured ? `ya la tiene configurada en ${formatPeriod(record.period)}` : "sin probabilidad calculada (no es 0 %)";
}

/** `criteria` keeps, per «professor:tool», the list each person was marked from; `note` and the quotas go in every row. */
export function exportSelectionCsv(selection: Selection, period: PeriodId = DEFAULT_PERIOD, { criteria = {}, note = "", date = new Date(), capacity = {}, total }: { criteria?: Record<string, string>; note?: string; date?: Date; capacity?: Partial<Record<ToolId, number>>; total?: number } = {}): string {
  // The reason for each invitation travels with the file; the group stays out (its names are pending).
  const next = TEXTS.cleanTest ? `en ${formatPeriod(TEXTS.cleanTest)}` : "el semestre siguiente";
  const header = ["Profesor (código seudónimo)", "Código", "Facultad", "Nombre de la facultad", "Herramientas", "Talleres", "Semestre consultado", "Estados por herramienta", "Criterio", "Fuente", "Por qué está en ese estado", "Qué conversar (sugerencia inicial)", `Probabilidad de configurarla ${next} (si vuelve a dictar, no mide si el taller le servirá)`, "Antecedente de la probabilidad", "Nota", "Cupo escrito en el tablero"];
  const downloaded = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  // One workshop: highest probability first, as «Por taller» lists it; several: code order. Tools in their fixed order.
  const marked = [...new Set(Object.values(selection).flat())];
  const chance = (professor: Professor) => { const at = lastTaughtPeriod(professor, period); const p = marked.length === 1 && at ? getRecord(professor.id, marked[0], at).probability : null; return p === null ? -1 : shown(p); };
  const people = marked.length === 1 ? PROFESSORS.filter(p => selection[p.id]?.length).sort((a, b) => chance(b) - chance(a) || a.id.localeCompare(b.id)) : PROFESSORS;
  const rows = people.flatMap(professor => {
    const tools = TOOLS.filter(tool => selection[professor.id]?.includes(tool.id));
    if (!tools.length) return [];
    const faculty = facultyAt(professor, period);
    const at = lastTaughtPeriod(professor, period);
    const records = at ? tools.map(tool => getRecord(professor.id, tool.id, at)) : [];
    const perTool = (text: (record: TeacherToolRecord) => string) => at ? records.map(record => `${record.tool.name}: ${text(record)}`).join(" | ") : `no había dictado hasta ${formatPeriod(period)}`;
    const lists = tools.filter(tool => criteria[`${professor.id}:${tool.id}`]).map(tool => `${tool.name}: ${criteria[`${professor.id}:${tool.id}`]}`);
    return [[professor.name, professor.id, faculty, facultyName(faculty), tools.map(tool => tool.name).join(" | "), [...new Set(tools.map(tool => tool.workshop))].join(" | "), formatPeriod(period), tools.map(tool => `${tool.name}: ${selectionState(professor.id, tool.id, period)}`).join(" | "), `Elegido en el tablero${lists.length ? ` (${lists.join(" | ")})` : " (sin la lista: se marcó antes de recargar la página o de cambiar de archivo)"}; falta confirmar con el profesor que el taller le sirve`, `${TEXTS.csv} · lista descargada el ${downloaded}`,
      perTool(plainReason),
      // Configuration-only tools get no guidance (decision #13), and the cell says so instead of staying empty.
      perTool(record => record.tool.evidence === "configuracion" ? "sin sugerencia (de esta herramienta solo hay datos de configuración)" : GUIDANCE[record.state]),
      perTool(forecastText),
      perTool(record => record.forecastReason ?? "—"),
      note.trim(),
      [...tools.filter(tool => capacity[tool.id] !== undefined).map(tool => `${tool.name}: ${capacity[tool.id]}`), ...(total === undefined ? [] : [`total de la convocatoria: ${total}`])].join(" | ")]];
  });
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export { FACULTIES };
