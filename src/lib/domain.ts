import { FACULTIES, MIN_PROFESSORS, OBSERVATIONS, PERIODS, PROFESSORS, TEXTS, TOOLS, VALIDATION_ROWS, probabilityBand, startProbability, startReason } from "./data";
import { CONDITION_LABELS, type AdoptionState, type Condition, type Filters, type GroupId, type Observation, type PeriodId, type ProbabilityBand, type Professor, type Selection, type TeacherToolRecord, type Tool, type ToolId } from "./types";

export function formatPeriod(period: string): string {
  const match = /^(\d{4})(10|20)$/.exec(period);
  return match ? `${match[1]}-${match[2] === "10" ? "1" : "2"}` : period;
}

const periodIndex = (period: PeriodId) => PERIODS.indexOf(period);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const semesters = (n: number) => n === 1 ? "1 semestre" : `${n} semestres`;

/** `taught` are the semesters the professor taught: completeness and runs skip semesters without teaching. */
export function classify(history: Observation[], tool: Tool, taught: readonly PeriodId[] = PERIODS): { state: AdoptionState; condition: Condition | null; reason: string; sustainedPeriods: number; firstEffectivePeriod: PeriodId | null } {
  const all = history.filter(row => row.toolId === tool.id).sort((a, b) => periodIndex(a.period) - periodIndex(b.period));
  const latest = all.at(-1);
  // A semester without effective-use data is skipped like one without teaching: it neither cuts nor counts a run.
  const missing = new Set(all.filter(row => row.effective === null).map(row => row.period));
  const rows = all.filter(row => row.effective !== null);
  const firstEffectivePeriod = rows.find(row => row.effective === true)?.period ?? null;
  let sustainedPeriods = 0;
  if (latest?.effective !== null) for (let i = rows.length - 1; i >= 0 && rows[i].effective === true; i--) sustainedPeriods++;
  const skipped = !missing.size ? "" : missing.size === 1 ? " Un semestre no tiene dato de uso efectivo: no corta ni cuenta en su historia." : ` ${missing.size} semestres no tienen dato de uso efectivo: no cortan ni cuentan en su historia.`;
  const result = (state: AdoptionState, reason: string, condition: Condition | null = null) => ({ state, condition, reason: condition ? reason : reason + skipped, sustainedPeriods, firstEffectivePeriod });
  if (tool.evidence === "configuracion") return result("Sin información", "Para esta herramienta solo hay datos de configuración: no se asigna un estado del marco.", "configuracion");
  if (!latest) return result("Sin información", "No hay observaciones para esta herramienta.", "dato");
  if (latest.effective === null) return result("Sin información", "Falta el dato de uso efectivo de este semestre, así que no se le asigna un estado.", "dato");
  const expected = taught.filter(period => periodIndex(period) <= periodIndex(latest.period) && !missing.has(period));
  const duplicatePeriods = new Set(all.map(row => row.period)).size !== all.length;
  const fullHistory = expected.length === rows.length && expected.every((period, i) => rows[i].period === period);
  if (duplicatePeriods || !fullHistory) {
    return result("Sin información", "La historia tiene observaciones faltantes o no comparables; no se interpreta la ausencia como falta de uso.", "dato");
  }
  // Effective use is an independent field, never inferred from configuration.
  if (rows.some(row => row.effective === true && row.configured !== true)) {
    return result("Sin información", "La evidencia de configuración y uso efectivo es inconsistente.", "dato");
  }
  if (!firstEffectivePeriod) {
    const configured = rows.filter(row => row.configured === true).length;
    return result("No expuesto", TEXTS.neverExposed(rows.length, formatPeriod(PERIODS[0])) + (configured ? ` La tuvo configurada en ${semesters(configured)}, sin actividad de estudiantes.` : ""));
  }
  if (latest.effective === true) {
    const earlierUse = rows.slice(0, -1).some(row => row.effective === true);
    if (!earlierUse) return result("Adopta", "Primer uso efectivo registrado; todavía no se confirma su continuidad.");
    if (sustainedPeriods < 2) return result("Sin información", "Retomó el uso después de una interrupción; este tablero no asigna una etapa a la reactivación.", "regla");
    const currentRun = rows.slice(-sustainedPeriods);
    const completeIntensity = currentRun.every(row => row.intensity !== null && Number.isFinite(row.intensity));
    if (completeIntensity && tool.threshold !== null && median(currentRun.map(row => row.intensity!)) > tool.threshold) {
      return result("Apropia", `Uso efectivo durante ${sustainedPeriods} periodos consecutivos e intensidad mediana superior al corte de apropiación (${tool.threshold}).`);
    }
    return result("Usa", `Uso efectivo durante ${sustainedPeriods} periodos consecutivos${completeIntensity ? "; la mediana no supera el corte de apropiación." : "; falta intensidad comparable para evaluar apropiación."}`);
  }
  let maximumRun = 0;
  let run = 0;
  for (const row of rows) {
    run = row.effective === true ? run + 1 : 0;
    maximumRun = Math.max(maximumRun, run);
  }
  if (maximumRun >= 2) return result("Abandona", "Se observó uso efectivo sostenido y posteriormente dejó de registrarse; no implica abandono definitivo.");
  return result("Sin información", "Hubo un ensayo aislado que no continuó; no cumple la condición de uso sostenido previo para Abandona.", "regla");
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

const observationIndex = new Map<string, Observation[]>();
for (const row of OBSERVATIONS) {
  const key = `${row.professorId}:${row.toolId}`;
  const rows = observationIndex.get(key) ?? [];
  rows.push(row);
  observationIndex.set(key, rows);
}
const recordCache = new Map<string, TeacherToolRecord>();
const professorIndex = new Map(PROFESSORS.map(professor => [professor.id, professor]));
const toolIndex = new Map(TOOLS.map(tool => [tool.id, tool]));
const professorsByPeriod = new Map(PERIODS.map(period => [period, PROFESSORS.filter(professor => professor.periods.includes(period))]));

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
export const configuredLabel = (configured: boolean | null) => configured === null ? "sin dato" : configured ? "sí" : "no";
/** Rows of the current run of effective use; semesters without data are skipped, as in classify(). */
export const activeRun = (record: TeacherToolRecord): Observation[] => record.sustainedPeriods ? record.history.filter(row => row.effective !== null).slice(-record.sustainedPeriods) : [];

/** «n %», or «n de N · pocos profesores» with no ratio (so no bar) when the base is under the source's minimum. */
export function share(n: number, total: number): { ratio: number | null; text: string } {
  if (total >= MIN_PROFESSORS) return { ratio: n / total, text: `${Math.round(n / total * 100)} %` };
  return { ratio: null, text: total ? `${n} de ${total} · pocos profesores` : "—" };
}

const habitual = new Map(TOOLS.map(tool => {
  const rows = VALIDATION_ROWS.filter(row => row.toolId === tool.id);
  return [tool.id, rows.length ? rows.filter(row => row.outcome).length / rows.length : null];
}));
/** Share of the tool's validation cases that started to configure it: the reference for its bands. */
export const habitualRate = (toolId: ToolId): number | null => habitual.get(toolId) ?? null;
// One decimal under 10 %; bands are decided on this same rounded number.
const shown = (p: number) => p < 0.001 ? 0 : Math.round(p * 1000) < 100 ? Math.round(p * 1000) / 1000 : Math.round(p * 100) / 100;
/** «42 %», «4,2 %» under 10 % and «menos de 0,1 %» under 0.1 %. */
export function formatProbability(p: number): string {
  if (p < 0.001) return "menos de 0,1 %";
  const value = shown(p);
  const digits = value < 0.1 ? 1 : 0;
  return `${(value * 100).toLocaleString("es-CO", { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;
}
export function probabilityBandFor(toolId: ToolId, p: number): ProbabilityBand {
  const rate = habitualRate(toolId);
  return probabilityBand(shown(p), rate === null ? null : shown(rate));
}
/** The upper band cut exactly as probabilityBandFor applies it: «50 %», or «10,4 %» when it needs the decimal. */
export function formatDoubleRate(toolId: ToolId): string {
  const cut = 2 * shown(habitualRate(toolId) ?? 0);
  return `${(cut * 100).toLocaleString("es-CO", { minimumFractionDigits: cut < 0.1 ? 1 : 0, maximumFractionDigits: 1 })} %`;
}

const normalized = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

export function getRecords(filters: Partial<Filters> = {}): TeacherToolRecord[] {
  const { period = "202520", tool = "rubricas", faculty = "Todos", group = "Todos", state = "Todos", probability = "Todas", search = "" } = filters;
  const query = normalized(search.trim());
  return (professorsByPeriod.get(period) ?? []).map(professor => getRecord(professor.id, tool, period)).filter(record => {
    if (faculty !== "Todos" && record.faculty !== faculty) return false;
    if (group !== "Todos" && record.originGroup !== group) return false;
    if (state !== "Todos" && record.state !== state) return false;
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
  if (record.tool.evidence === "configuracion") return `solo configuración: ${configuredLabel(record.observation.configured)} en ${formatPeriod(at)}`;
  return at === period ? stateLabel(record) : `${stateLabel(record)} (último semestre dictado: ${formatPeriod(at)})`;
}

/** RFC-style quoted cells, semicolon separator, UTF-8 BOM and spreadsheet safety. */
function csvCell(value: string): string {
  // A quoted CSV cell can still execute as a spreadsheet formula after import.
  const safe = /^[\s﻿]*[=+@-]/u.test(value) || /^[\t\r]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function exportSelectionCsv(selection: Selection, period: PeriodId = "202520"): string {
  const header = ["Profesor", "Código", "Facultad", "Herramientas", "Talleres", "Periodo de consulta", "Estados por herramienta", "Criterio", "Fuente"];
  // Professors in code order and tools in their fixed order, as the call dialog lists them.
  const rows = PROFESSORS.flatMap(professor => {
    const tools = TOOLS.filter(tool => selection[professor.id]?.includes(tool.id));
    if (!tools.length) return [];
    return [[professor.name, professor.id, facultyAt(professor, period), tools.map(tool => tool.name).join(" | "), [...new Set(tools.map(tool => tool.workshop))].join(" | "), formatPeriod(period), tools.map(tool => `${tool.name}: ${selectionState(professor.id, tool.id, period)}`).join(" | "), "Selección manual para revisión de pertinencia", TEXTS.csv]];
  });
  return `﻿${[header, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
}

export { FACULTIES };
