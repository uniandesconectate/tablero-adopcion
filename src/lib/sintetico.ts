import type { Group, GroupId, Observation, PeriodId, ProbabilityBand, Professor, Tool, ValidationRow } from "./types";

/** All records in this module are fictional. They are not institutional results. */
export const DATA_SOURCE = "Demostración con datos sintéticos";
export const PERIODS: PeriodId[] = ["202320", "202410", "202420", "202510", "202520"];
// Every synthetic period can be consulted; real data keeps its first semesters as history only.
export const SELECTABLE_PERIODS = PERIODS;
// Same minimum as the real export: under 30 teachers a percent is not shown.
export const MIN_PROFESSORS = 30;
// Every synthetic professor teaches every period.
export const RETURN_SHARE = 1;
// Each source keeps its own draft selection, so switching sources does not erase the other one.
export const SELECTION_KEY = "conectate-convocatoria-v1";
// UI texts that depend on the source; real.ts exports the same keys.
export const TEXTS = {
  badge: "Datos sintéticos",
  identity: "Identidad ficticia · Demostración",
  csv: "Datos sintéticos · no enviar como convocatoria real",
  selection: "Las identidades y datos son sintéticos.",
  estimate: "Estimación sintética",
  estimates: "Probabilidades ilustrativas para quienes no tienen configuración registrada.",
  model: "Demostración con datos sintéticos. Las probabilidades y los cortes de esta propuesta son ilustrativos.",
  method: "Este prototipo usa profesores, observaciones y predicciones sintéticos.",
  rulesTitle: "Reglas ilustrativas de esta demostración",
  rules: ["Usa requiere dos periodos consecutivos con uso efectivo. Apropia exige además que la mediana del tramo activo supere un corte específico por herramienta. Los cortes son ilustrativos y deben validarse con Conecta-TE sobre observaciones con uso efectivo."],
  intensity: (threshold: number | null) => `Índice sintético · corte ${threshold}`,
  toolRule: (tool: Tool): [string, string] => ["Cómo se calcula esta demostración.", `Dos periodos consecutivos de uso efectivo confirman Usa. Apropia exige además superar un corte de intensidad ilustrativo de ${tool.threshold}. Estos parámetros permiten probar el recorrido; requieren validación de Conecta-TE.`],
  // Synthetic forecasts exist in every period; real ones only at the forecast origin.
  forecastOrigin: null as PeriodId | null,
  csvName: (period: PeriodId) => `convocatoria-conectate-demo-${period}.csv`,
  neverExposed: (_taught: number, since: string) => `Sin uso efectivo registrado desde ${since}, con historia completa en la ventana de demostración.`,
  bands: { Baja: "Menos de 35 %", Media: "35 % a menos de 65 %", Alta: "65 % o más" } as Record<ProbabilityBand, string>,
  searchPlaceholder: "Nombre o código…",
  // Juan's fixed cuts do not depend on a habitual rate.
  relativeBands: false,
  // The demo has no held-out semester for a clean test.
  cleanTest: null as PeriodId | null,
};

// Synthetic thresholds are always numbers; only real configuration-only tools lack one.
export const TOOLS: Array<Tool & { threshold: number }> = [
  { id: "contenidos", name: "Contenidos", description: "Materiales y recursos del aula virtual.", threshold: 1.4, workshop: "Organizar materiales y recursos" },
  { id: "actividades", name: "Actividades", description: "Actividades con entrega de trabajos.", threshold: 1.1, workshop: "Diseñar actividades con entregas" },
  { id: "anuncios", name: "Anuncios", description: "Comunicaciones y orientación para el curso.", threshold: 0.9, workshop: "Comunicar y orientar en el aula" },
  { id: "calificaciones", name: "Calificaciones", description: "Organización de la evaluación y sus resultados.", threshold: 1.2, workshop: "Organizar el libro de calificaciones" },
  { id: "cuestionarios", name: "Cuestionarios", description: "Preguntas y evaluaciones configuradas en la plataforma.", threshold: 1.05, workshop: "Diseñar cuestionarios" },
  { id: "rubricas", name: "Rúbricas", description: "Criterios explícitos para evaluar y retroalimentar.", threshold: 1, workshop: "Evaluar y retroalimentar con rúbricas" },
  { id: "debates", name: "Debates", description: "Conversaciones y actividades de discusión.", threshold: 0.85, workshop: "Facilitar debates y participación" },
];

export const GROUPS: Group[] = [
  { id: "g0", name: "Evaluación sin rúbricas observadas", description: "Tres o cuatro herramientas con configuración observada, entre ellas cuestionarios o calificaciones, sin configuración de rúbricas observada." },
  { id: "g1", name: "Uso de varias herramientas", description: "Cinco o más herramientas con configuración observada en el periodo." },
  { id: "g2", name: "Configuración escasa", description: "Hasta dos herramientas con configuración observada en el periodo; los datos faltantes no se interpretan como ausencia de configuración." },
  { id: "g3", name: "Materiales y comunicación", description: "Tres o cuatro herramientas con configuración observada, principalmente contenidos, actividades o anuncios, y posibles debates." },
  { id: "g4", name: "Rúbricas y otras herramientas", description: "Tres o cuatro herramientas con configuración observada, entre ellas rúbricas." },
];

export const FACULTIES = ["Ingeniería", "Ciencias", "Ciencias Sociales", "Artes y Humanidades", "Administración", "Educación"];
const departments = ["Ingeniería de Sistemas", "Matemáticas", "Ciencias Sociales", "Artes", "Administración", "Educación"];
const firstNames = ["Camila", "Santiago", "Valentina", "Mateo", "Isabella", "Sebastián", "Mariana", "Nicolás", "Laura", "Daniel", "Gabriela", "Alejandro", "Paula", "Felipe", "Luciana", "Andrés", "Juliana", "Esteban", "Natalia", "Simón", "Manuela", "David", "Sara", "Julián"];
const lastNames = ["Restrepo", "Cárdenas", "Rincón", "Pardo", "Salcedo", "Medina", "Quintero", "Vargas", "Acosta", "Montoya", "Duarte", "Arango"];

export const PROFESSORS: Professor[] = Array.from({ length: 96 }, (_, i) => {
  const first = firstNames[i % firstNames.length];
  const last = lastNames[(Math.floor(i / firstNames.length) * 3 + i % 3) % lastNames.length];
  // Temporary value; membership is filled from observed configurations below.
  const groupByPeriod = Object.fromEntries(PERIODS.map(period => [period, "g2"])) as Record<PeriodId, GroupId>;
  const faculty = FACULTIES[i % FACULTIES.length];
  return { id: `DEMO-${String(i + 1).padStart(3, "0")}`, name: `${first} ${last}`, initials: `${first[0]}${last[0]}`, faculty, facultyByPeriod: Object.fromEntries(PERIODS.map(period => [period, faculty])), department: departments[i % departments.length], groupByPeriod, periods: [...PERIODS] };
});

// Complete and deliberately contrasting histories exercise the framework's limits.
// Configuration is generated independently of effective use: a configured resource
// can have no student interaction and never counts as effective just for existing.
const patterns: Array<Array<boolean | null>> = [
  [false, false, false, false, false],
  [false, false, false, false, false],
  [false, false, false, false, true],
  [false, false, false, true, true],
  [false, false, true, true, true],
  [false, true, true, false, false],
  [false, false, true, false, false],
  [true, true, false, false, true],
  [false, null, false, true, true],
  [false, false, true, true, true],
  [false, false, false, false, false],
  [false, true, true, true, false],
];

// Different illustrative mixtures make tool comparisons useful in the demo.
// These weights describe this scenario only; they are not institutional rates.
const toolPatterns = [
  [4, 4, 4, 4, 9, 9, 9, 3, 3, 3, 2, 2, 0, 10, 11, 8],
  [4, 4, 4, 9, 9, 3, 3, 3, 2, 2, 2, 0, 1, 5, 11, 8],
  [4, 4, 9, 9, 3, 3, 3, 3, 2, 2, 0, 0, 10, 5, 11, 8],
  [4, 4, 4, 9, 9, 3, 3, 2, 2, 0, 10, 5, 5, 11, 8, 6],
  [4, 4, 9, 3, 3, 2, 2, 2, 0, 0, 1, 10, 5, 11, 8, 7],
  [4, 9, 3, 3, 2, 2, 0, 0, 0, 1, 10, 5, 5, 11, 8, 6],
  [4, 9, 3, 2, 2, 0, 0, 0, 0, 1, 10, 5, 11, 8, 6, 7],
];

export const OBSERVATIONS: Observation[] = PROFESSORS.flatMap((professor, i) => TOOLS.flatMap((tool, ti) => {
  const mixture = toolPatterns[ti];
  const patternId = mixture[(i * 7 + Math.floor(i / mixture.length) * 5 + ti * 3) % mixture.length];
  const pattern = patterns[patternId];
  return PERIODS.map((period, pi): Observation => {
    const effective = pattern[pi];
    const missing = effective === null || (patternId === 8 && pi === 4);
    // The demo has no co-teaching data, so shared classrooms stay unknown.
    if (missing) return { professorId: professor.id, toolId: tool.id, period, configured: null, effective: null, reach: null, intensity: null, shared: null };
    const configuredWithoutUse = patternId === 10 || (patternId === 1 && pi === 2);
    const configured = effective === true || configuredWithoutUse;
    const intensity = !effective ? 0 : patternId === 4 ? tool.threshold + 0.35 + (pi % 3) * 0.08 : patternId === 9 ? tool.threshold : Math.max(0.1, tool.threshold - 0.4 + ((i + pi) % 3) * 0.07);
    const reach = !effective ? 0 : Math.min(0.96, 0.29 + ((i * 7 + ti * 11 + pi * 3) % 60) / 100);
    return { professorId: professor.id, toolId: tool.id, period, configured, effective, reach, intensity: Math.round(intensity * 100) / 100, shared: null };
  });
}));

// Synthetic descriptive rules, not K-Means assignments or a ranking of teachers.
// Each period uses only its own observed configurations. Unknown values remain
// unknown in OBSERVATIONS and never count as either a positive or a known zero.
// The names describe observed evidence, not a claim of complete measurement.
for (const professor of PROFESSORS) for (const period of PERIODS) {
  const configured = OBSERVATIONS.filter(row => row.professorId === professor.id && row.period === period && row.configured === true);
  const has = (toolId: Tool["id"]) => configured.some(row => row.toolId === toolId);
  professor.groupByPeriod[period] = configured.length <= 2 ? "g2"
    : configured.length >= 5 ? "g1"
      : has("rubricas") ? "g4"
        : has("cuestionarios") || has("calificaciones") ? "g0"
          : "g3";
}

function hash(value: string): number {
  let h = 2166136261;
  for (const char of value) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Reproducible scenario, not a trained institutional model or a causal estimate. */
function syntheticStartProbability(professor: Professor, tool: Tool, history: Observation[]): number {
  const last = history.at(-1)!;
  const pastConfiguration = history.slice(0, -1).some(row => row.configured === true);
  const scenarioVariation = (hash(`${professor.id}:${tool.id}:${last.period}`) % 73) / 100;
  const value = 0.06 + scenarioVariation + (pastConfiguration ? 0.1 : 0) + (professor.faculty === "Educación" ? 0.03 : 0);
  return Math.round(Math.min(0.91, Math.max(0.04, value)) * 100) / 100;
}

/** Any known non-configured tool gets a scenario, whatever its state; `history` ends at the queried period. */
export function startProbability(professor: Professor, tool: Tool, history: Observation[]): number | null {
  return history.at(-1)?.configured === false ? syntheticStartProbability(professor, tool, history) : null;
}

/** Configuration background of each scenario, worded as in the real export. */
export function startReason(_professor: Professor, _tool: Tool, history: Observation[]): string | null {
  if (history.at(-1)?.configured !== false) return null;
  const n = history.slice(0, -1).filter(row => row.configured === true).length;
  return n ? `La configuró en ${n} semestre${n === 1 ? "" : "s"} anterior${n === 1 ? "" : "es"} (desde 2023-2).` : "No la ha configurado en los semestres anteriores (desde 2023-2).";
}

/** Juan's fixed cuts; `p` is the probability as shown. */
export function probabilityBand(p: number, _habitual: number | null): ProbabilityBand {
  return p >= 0.65 ? "Alta" : p >= 0.35 ? "Media" : "Baja";
}

/** The synthetic demo has no next-group forecast. */
export function nextGroupProbabilities(_professorId: string, _period: PeriodId): number[] | null {
  return null;
}

// Historical synthetic opportunities. `period` is ARRIVAL; probabilities use
// only observations available at the preceding origin. No professor IDs leave
// this validation contract, mirroring the limited production input contract.
export const VALIDATION_ROWS: ValidationRow[] = [];
for (const professor of PROFESSORS) for (const tool of TOOLS) for (const arrival of ["202510", "202520"] as const) {
  const arrivalIndex = PERIODS.indexOf(arrival);
  const history = OBSERVATIONS.filter(row => row.professorId === professor.id && row.toolId === tool.id && PERIODS.indexOf(row.period) < arrivalIndex);
  const origin = history.at(-1)!;
  const outcome = OBSERVATIONS.find(row => row.professorId === professor.id && row.toolId === tool.id && row.period === arrival)!;
  if (origin.configured !== false || outcome.configured === null || history.some(row => row.effective === null)) continue;
  VALIDATION_ROWS.push({ toolId: tool.id, period: arrival, probability: syntheticStartProbability(professor, tool, history), outcome: outcome.configured });
}
