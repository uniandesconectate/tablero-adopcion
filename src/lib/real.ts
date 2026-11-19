import type { Group, Observation, PeriodId, ProbabilityBand, Professor, Tool, ValidationRow } from "./types";

// Contract of tablero.json, the file the Conecta-TE Databricks process writes each semester.
const CONTRACT = "tablero-adopcion/v2";
type Flag = 0 | 1 | null;
interface Contract {
  contrato: string;
  fuente: {
    etiqueta: string;
    generado: string;
    modelo: { nombre: string; version: string; entrenado_hasta: string; supuestos: string[] };
    reglas: { uso_efectivo: string; intensidad: string; corte_apropia: string; periodos_seguidos: number; seguidos: string; consultable_desde: PeriodId; minimo_profesores: number };
    vuelven_siguiente: number;
  };
  periodos: PeriodId[];
  pronostico: { origen: PeriodId; destino: PeriodId };
  herramientas: Array<{ id: string; nombre: string; evidencia: "uso" | "configuracion"; descripcion: string; taller: string; umbral: number | null; pronostico: boolean }>;
  grupos: Array<{ id: string; nombre: string; descripcion: string }>;
  profesores: { id: string[]; facultad: Array<string | null>; contrato: Array<string | null> };
  filas: { profesor: number[]; periodo: number[]; grupo: string[]; facultad: Array<string | null>; compartidas: Flag[] };
  uso: Record<string, { configurada: Flag[]; efectiva: Flag[]; alcance: Array<number | null>; intensidad: Array<number | null> }>;
  pronosticos: { profesor: number[]; herramienta: number[]; prob: number[]; razon: string[] };
  perfil_siguiente: { profesor: number[]; prob: number[][] };
  validacion: { herramienta: number[]; llegada: PeriodId[]; prob: number[]; empezo: Flag[] };
}

function fail(message: string): never {
  throw new Error(`Datos reales (tablero.json): ${message}`);
}
const flag = (value: unknown) => value === 1 ? true : value === 0 ? false : value === null ? null : fail(`un indicador no es 1, 0 ni null: ${JSON.stringify(value)}.`);
const amount = (value: unknown) => value === null || typeof value === "number" ? value : fail(`un valor no es número ni null: ${JSON.stringify(value)}.`);
const probability = (value: unknown) => typeof value === "number" && value >= 0 && value <= 1 ? value : fail(`una probabilidad no está entre 0 y 1: ${JSON.stringify(value)}.`);
const at = (index: number, length: number, where: string) => Number.isInteger(index) && index >= 0 && index < length ? index : fail(`${where} usa un índice que no existe: ${index}.`);
const unique = (ids: string[], what: string) => { if (new Set(ids).size !== ids.length) fail(`hay ${what} con el id repetido.`); };
/** «202520» → «2025-2» inside the export's texts. */
const human = (text: string) => text.replace(/\b(\d{4})(10|20)\b/g, (_, year: string, term: string) => `${year}-${term === "10" ? "1" : "2"}`);
// Academic faculties of ref_v3.facultades_t (pipeline_databricks/v3/00_Ref_parametros.py).
const FACULTY_NAMES: Record<string, string> = { AD: "Administración", AQ: "Arquitectura y Diseño", AT: "Artes y Humanidades", CI: "Ciencias", CP: "Centro de Estudios en Periodismo", DE: "Derecho", EC: "Economía", ED: "Educación", EG: "Escuela de Gobierno Alberto Lleras", HU: "Ciencias Sociales", IN: "Ingeniería", ME: "Medicina" };
const CONTRACTS: Record<string, string> = { catedra: "Cátedra", planta: "Planta", asistente_graduado: "Asistente graduado", otro_profesor: "Otro profesor", otro: "Otro", sin_asignar: "Sin asignar" };
// shortcut: external-tool reasons count from 2020-2 like the internal ones (k5_markov.SEMESTRES); move the mark to the exporter when it is regenerated.
const sinceStart = (text: string) => text.replace(/^(La tuvo en sus aulas en algún semestre anterior|No la ha tenido en sus aulas antes)\.$/, "$1 (desde 2020-2).");
const aligned = (what: string, columns: unknown[][]) => { if (!columns.every(column => Array.isArray(column) && column.length === columns[0].length)) fail(`las columnas de ${what} no tienen el mismo largo.`); };

/** Validates a tablero.json and builds the source the dashboard reads (data.ts). */
export function buildRealSource(input: unknown) {
  const data = input as Contract;
  if (data?.contrato !== CONTRACT) fail(`no es un tablero.json del proceso de datos de Conecta-TE${typeof data?.contrato === "string" ? ", o es de una versión anterior" : ""}. Pide el tablero.json del semestre al equipo de datos. (Para el equipo de datos: se esperaba el formato "${CONTRACT}"${typeof data?.contrato === "string" ? ` y este trae «${data.contrato}»` : ""}.)`);
  for (const key of ["fuente", "periodos", "pronostico", "herramientas", "grupos", "profesores", "filas", "uso", "pronosticos", "perfil_siguiente", "validacion"] as const) if (data[key] == null) fail(`le falta una parte, así que está incompleto o viene de otro proceso. Descárgalo de nuevo. (Para el equipo de datos: falta la clave "${key}".)`);
  const { fuente, periodos, pronostico, herramientas, grupos, profesores, filas, uso, pronosticos, validacion } = data;
  const { modelo, reglas } = fuente;
  if (![fuente.etiqueta, fuente.generado, modelo?.nombre, modelo?.version, modelo?.entrenado_hasta, reglas?.uso_efectivo, reglas?.intensidad, reglas?.corte_apropia, reglas?.seguidos].every(text => typeof text === "string") || !Array.isArray(modelo.supuestos)) fail("faltan textos en fuente.modelo o fuente.reglas.");
  // classify() applies two semesters in a row; a different rule in the file must not be shown as applied.
  if (reglas.periodos_seguidos !== 2) fail("el tablero aplica dos semestres seguidos para Usa y el archivo pide otro número.");
  if (periodos.some((period, i) => i > 0 && periodos[i - 1] >= period)) fail("los periodos deben venir en orden y sin repetirse.");
  if (!periodos.includes(pronostico.origen)) fail(`el origen del pronóstico (${pronostico.origen}) no está entre los periodos.`);
  if (typeof pronostico.destino !== "string" || !/^\d{4}(10|20)$/.test(pronostico.destino) || pronostico.destino <= pronostico.origen) fail("pronostico.destino debe ser un semestre posterior al origen.");
  if (!periodos.includes(reglas.consultable_desde) || reglas.consultable_desde > pronostico.origen) fail("fuente.reglas.consultable_desde debe ser uno de los periodos, sin pasar del origen del pronóstico.");
  if (!Number.isInteger(reglas.minimo_profesores) || reglas.minimo_profesores < 1) fail("fuente.reglas.minimo_profesores debe ser un entero mayor que 0.");
  const returnShare = probability(fuente.vuelven_siguiente);

  if (!herramientas.length) fail("no trae herramientas.");
  unique(herramientas.map(tool => tool.id), "herramientas");
  const TOOLS: Tool[] = herramientas.map(tool => {
    if (tool.evidencia !== "configuracion" && (tool.evidencia !== "uso" || typeof tool.umbral !== "number")) fail(`la herramienta ${tool.id} no trae una evidencia válida o le falta el umbral.`);
    if (!uso[tool.id]) fail(`falta el uso de la herramienta ${tool.id}.`);
    if (typeof tool.pronostico !== "boolean") fail(`la herramienta ${tool.id} no dice si tiene pronóstico.`);
    return { id: tool.id, name: tool.nombre, description: tool.descripcion, threshold: tool.umbral, workshop: tool.taller, evidence: tool.evidencia, forecast: tool.pronostico };
  });
  // Next-group probabilities are positional (p0..p4), so the groups must come as C0..C4.
  if (grupos.some((group, k) => group.id !== `C${k}`)) fail("los grupos deben venir como C0, C1, ... en ese orden.");
  const GROUPS: Group[] = grupos.map(group => ({ id: group.id, name: group.nombre, description: group.descripcion }));

  aligned("profesores", [profesores.id, profesores.facultad, profesores.contrato]);
  unique(profesores.id, "profesores");
  if (!profesores.id.every(id => /^D-[0-9a-f]{8}$/.test(id))) fail("hay un profesor sin código seudónimo (D- y 8 caracteres hexadecimales).");
  // shortcut: `department` carries the contract label shown in the UI; add a field if both are ever needed.
  const PROFESSORS: Professor[] = profesores.id.map((id, i) => ({ id, name: id, initials: id.slice(2, 4).toUpperCase(), faculty: profesores.facultad[i] ?? "Sin facultad registrada", facultyByPeriod: {}, department: `Contrato: ${CONTRACTS[profesores.contrato[i] ?? ""] ?? profesores.contrato[i] ?? "sin registro"}`, groupByPeriod: {}, periods: [] }));

  aligned("filas y uso", [filas.profesor, filas.periodo, filas.grupo, filas.facultad, filas.compartidas, ...TOOLS.flatMap(tool => [uso[tool.id].configurada, uso[tool.id].efectiva, uso[tool.id].alcance, uso[tool.id].intensidad])]);
  const groupIds = new Set(GROUPS.map(group => group.id));
  // Rows in calendar order keep each professor's history sorted, as domain.ts expects.
  const order = filas.periodo.map((_, row) => row).sort((a, b) => filas.periodo[a] - filas.periodo[b]);
  const OBSERVATIONS: Observation[] = [];
  for (const row of order) {
    const professor = PROFESSORS[at(filas.profesor[row], PROFESSORS.length, "una fila")];
    const period = periodos[at(filas.periodo[row], periodos.length, "una fila")];
    if (professor.groupByPeriod[period] !== undefined) fail(`el profesor ${professor.id} tiene dos filas en ${period}.`);
    if (!groupIds.has(filas.grupo[row])) fail(`una fila trae un grupo desconocido: ${JSON.stringify(filas.grupo[row])}.`);
    const faculty = filas.facultad[row];
    if (faculty !== null && typeof faculty !== "string") fail(`una fila trae una facultad que no es texto ni null: ${JSON.stringify(faculty)}.`);
    professor.groupByPeriod[period] = filas.grupo[row];
    professor.facultyByPeriod[period] = faculty ?? "Sin facultad registrada";
    professor.periods.push(period);
    const shared = flag(filas.compartidas[row]);
    for (const tool of TOOLS) {
      const use = uso[tool.id];
      OBSERVATIONS.push({ professorId: professor.id, toolId: tool.id, period, configured: flag(use.configurada[row]), effective: flag(use.efectiva[row]), reach: amount(use.alcance[row]), intensity: amount(use.intensidad[row]), shared });
    }
  }
  // A past semester can be filtered by a faculty that is no longer anyone's last one.
  const FACULTIES = [...new Set(PROFESSORS.flatMap(professor => [professor.faculty, ...Object.values(professor.facultyByPeriod)]))].sort((a, b) => a.localeCompare(b, "es"));

  const professorAt = (index: number, where: string) => PROFESSORS[at(index, PROFESSORS.length, where)];
  const toolAt = (index: number, where: string) => TOOLS[at(index, TOOLS.length, where)];
  aligned("pronosticos", [pronosticos.profesor, pronosticos.herramienta, pronosticos.prob, pronosticos.razon]);
  const forecasts = new Map(pronosticos.profesor.map((p, i): [string, [number, string]] => {
    const tool = toolAt(pronosticos.herramienta[i], "un pronóstico");
    if (!tool.forecast) fail(`${tool.name} no tiene modelo y trae pronósticos.`);
    if (typeof pronosticos.razon[i] !== "string") fail("cada pronóstico debe traer su razón como texto.");
    return [`${professorAt(p, "un pronóstico").id}:${tool.id}`, [probability(pronosticos.prob[i]), sinceStart(pronosticos.razon[i])]];
  }));
  if (forecasts.size !== pronosticos.profesor.length) fail("hay pronósticos repetidos para un mismo profesor y herramienta.");
  const next = data.perfil_siguiente;
  aligned("perfil_siguiente", [next.profesor, next.prob]);
  const nextGroups = new Map(next.profesor.map((p, i): [string, number[]] => {
    if (!Array.isArray(next.prob[i]) || next.prob[i].length !== GROUPS.length) fail("perfil_siguiente debe traer una probabilidad por grupo.");
    return [professorAt(p, "perfil_siguiente").id, next.prob[i].map(probability)];
  }));
  aligned("validacion", [validacion.herramienta, validacion.llegada, validacion.prob, validacion.empezo]);
  const VALIDATION_ROWS: ValidationRow[] = validacion.herramienta.map((tool, i) => ({ toolId: toolAt(tool, "una validación").id, period: validacion.llegada[i], probability: probability(validacion.prob[i]), outcome: flag(validacion.empezo[i]) ?? fail("validacion.empezo debe ser 0 o 1.") }));
  // Bands are relative to each tool's habitual start rate, so every tool with a model needs starts in its validation.
  for (const tool of TOOLS) {
    const rows = VALIDATION_ROWS.filter(row => row.toolId === tool.id);
    if (tool.forecast ? !rows.some(row => row.outcome) : rows.length) fail(tool.forecast ? `${tool.name} no tiene inicios en la validación, así que no hay una tasa habitual.` : `${tool.name} no tiene modelo y trae filas de validación.`);
  }

  const configurationOnly = TOOLS.filter(tool => tool.evidence === "configuracion").map(tool => tool.name);
  const TEXTS = {
    badge: "Datos reales",
    identity: "Código seudónimo: no es el nombre · uso interno",
    csv: `${fuente.etiqueta} · generado el ${fuente.generado}`,
    selection: "Cada profesor aparece con su código seudónimo; los datos son de uso interno. Pendiente: el equipo definirá cómo pasar del código a la persona.",
    estimate: `Versión del pronóstico: ${modelo.version}.`,
    estimates: human(`Probabilidades del modelo, con origen en ${pronostico.origen}, para quienes no tienen configuración registrada.`),
    model: human(`Modelo: ${modelo.nombre} · versión ${modelo.version} · entrenado hasta ${modelo.entrenado_hasta}. ${modelo.supuestos.join(" ")}`),
    modelPlain: human(`Con lo que cada profesor configuró en ${pronostico.origen} se estima qué hará la próxima vez que dicte; se supone que vuelve a dictar el semestre siguiente (${pronostico.destino}). El pronóstico aprendió de todos los cambios entre semestres hasta ${modelo.entrenado_hasta}. No usa datos de ${pronostico.destino}: se guardan para la prueba final.`),
    groupsOrigin: "Los 5 grupos los formó Lina, del equipo del proyecto, juntando a profesores que configuran herramientas parecidas (un método que arma 5 grupos; por eso «K5»).",
    method: "Este prototipo usa datos reales de Brightspace; cada profesor aparece con un código seudónimo.",
    rulesTitle: "Reglas de este tablero (provisionales)",
    rules: [reglas.uso_efectivo, `Usa requiere ${reglas.periodos_seguidos} semestres seguidos con uso efectivo. ${reglas.seguidos}`, human(reglas.corte_apropia), `${configurationOnly.join(", ")}: solo hay datos de configuración, así que no reciben un estado del marco.`],
    /** The same rules in plain words, for the first level. */
    plainRules: (tool: Tool) => [
      "Uso con estudiantes: la herramienta está configurada en al menos un aula y al menos un estudiante hizo algo en ella (basta uno). Si ningún estudiante tiene dato medible, queda sin información.",
      `Usa: ${reglas.periodos_seguidos} semestres seguidos o más con uso con estudiantes. Solo cuentan los semestres en que el profesor dicta: un semestre sin dictar no corta la racha ni suma.`,
      human(`Apropia: además de usarla seguido, en sus semestres de uso pone de forma típica más ${reglas.intensidad} que 3 de cada 4 semestres con uso de todos los profesores (de ${periodos[0]} a ${pronostico.origen}).${tool.threshold === null ? "" : ` En ${tool.name} el corte es más de ${tool.threshold.toLocaleString("es-CO")} ${reglas.intensidad}, contando todas sus aulas.`} Es un corte provisional que debe validar Conecta-TE. Si se recalcula con más semestres, pueden cambiar estados del pasado.`),
    ],
    unit: reglas.intensidad,
    intensity: (threshold: number | null) => threshold === null ? "Solo hay datos de configuración" : `En sus semestres seguidos de uso, contando todas sus aulas. Para Apropia: más de ${threshold.toLocaleString("es-CO")} (corte provisional, pendiente de validar por Conecta-TE).`,
    toolRule: (tool: Tool): [string, string] => tool.evidence === "configuracion"
      ? ["Solo hay datos de configuración.", `De ${tool.name} solo sabemos si está configurada: tenerla configurada no quiere decir que sus estudiantes la usen, así que no recibe estado.`]
      : ["Cómo se calcula.", human(`${reglas.uso_efectivo} Usa requiere ${reglas.periodos_seguidos} semestres seguidos con uso efectivo. ${reglas.seguidos} ${reglas.corte_apropia} Para ${tool.name}, ese corte es ${tool.threshold?.toLocaleString("es-CO")} ${reglas.intensidad}, contando todas sus aulas. Valor típico = mediana del tramo activo (sus semestres seguidos de uso). Corte = percentil 75.`)],
    forecastOrigin: pronostico.origen as PeriodId | null,
    facultyNames: FACULTY_NAMES,
    csvName: (period: PeriodId) => `convocatoria-conectate-${human(period)}.csv`,
    neverExposed: (taught: number, since: string) => `Sin uso efectivo en ${taught === 1 ? "el semestre que dictó" : `los ${taught} semestres que dictó`} desde ${since}.`,
    bands: { Baja: "Menos que lo habitual", Media: "Entre lo habitual y el doble", Alta: "Más del doble de lo habitual" } as Record<ProbabilityBand, string>,
    searchPlaceholder: "Código (D-…)",
    relativeBands: true,
    // The validation already chose the model; the forecast target is the first clean test.
    cleanTest: pronostico.destino as PeriodId | null,
  };
  const { origen } = pronostico;
  /** Forecasts exist only at the origin semester and only for tools known to be unconfigured there. */
  const forecastAt = (professor: Professor, tool: Tool, history: Observation[]) => {
    const current = history.at(-1);
    return current?.period === origen && current.configured === false ? forecasts.get(`${professor.id}:${tool.id}`) : undefined;
  };
  return {
    DATA_SOURCE: fuente.etiqueta, PERIODS: periodos, SELECTABLE_PERIODS: periodos.filter(period => period >= reglas.consultable_desde), MIN_PROFESSORS: reglas.minimo_profesores, RETURN_SHARE: returnShare,
    SELECTION_KEY: "conectate-convocatoria-real-v1", TEXTS, TOOLS, GROUPS, FACULTIES, PROFESSORS, OBSERVATIONS, VALIDATION_ROWS,
    startProbability: (professor: Professor, tool: Tool, history: Observation[]): number | null => forecastAt(professor, tool, history)?.[0] ?? null,
    startReason: (professor: Professor, tool: Tool, history: Observation[]): string | null => forecastAt(professor, tool, history)?.[1] ?? null,
    /** Relative to the tool's habitual rate; `p` and `habitual` are the numbers as shown. */
    probabilityBand: (p: number, habitual: number | null): ProbabilityBand => habitual === null ? fail("una herramienta con pronóstico no tiene tasa habitual.") : p < habitual ? "Baja" : p < 2 * habitual ? "Media" : "Alta",
    nextGroupProbabilities: (professorId: string, period: PeriodId): number[] | null => period === origen ? nextGroups.get(professorId) ?? null : null,
  };
}
