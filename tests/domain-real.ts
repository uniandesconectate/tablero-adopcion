// Run by real.test.ts in its own process, so domain.ts reads only the v2 fixture.
import test from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/tablero-ejemplo.json";
import { DATA_SOURCE, FACULTIES, PERIODS, PROFESSORS, SELECTABLE_PERIODS, TEXTS, TOOLS, setSource } from "../src/lib/data";
import { activeRun, exportSelectionCsv, facultyAt, formatDoubleRate, getRecord, getRecords, habitualRate, originGroup, probabilityBandFor, selectionState, share, stateLabel, summarize } from "../src/lib/domain";
import { buildRealSource } from "../src/lib/real";

setSource(buildRealSource(fixture));

const [p0, p1, p2, p3] = ["D-0a1b2c3d", "D-3f4e5d6c", "D-7a8b9c0d", "D-c1d2e3f4"];
const professor = (id: string) => PROFESSORS.find(item => item.id === id)!;
const ids = (filters: Parameters<typeof getRecords>[0]) => getRecords(filters).map(record => record.professor.id);

test("these checks run on the real source", () => assert.equal(DATA_SOURCE, "Datos reales de Brightspace · uso interno"));

test("R1: states can be consulted from 2022-2; the earlier semesters stay as history", () => {
  assert.deepEqual(SELECTABLE_PERIODS, ["202220", "202310", "202320", "202410", "202420", "202510", "202520"]);
  assert.equal(PERIODS.length, 9);
  assert.equal(getRecord(p0, "rubricas", "202520").history.length, 9);
});

test("R2: a semester without data gets no state and neither cuts nor counts the run", () => {
  const missing = getRecord(p0, "calificaciones", "202410");
  assert.deepEqual([missing.state, missing.condition, missing.sustainedPeriods], ["Sin información", "dato", 0]);
  assert.equal(getRecord(p0, "calificaciones", "202420").state, "Usa");
  const after = getRecord(p0, "calificaciones", "202520");
  assert.deepEqual([after.state, after.sustainedPeriods], ["Usa", 8]);
  assert.match(after.reason, /Un semestre no tiene dato de uso efectivo/);
  assert.equal(activeRun(after).length, 8);
  assert.ok(!activeRun(after).some(row => row.period === "202410"));
  // An old missing semester no longer leaves the teacher without state for good (problem 17).
  assert.equal(getRecord(p0, "contenidos", "202120").condition, "dato");
  assert.equal(getRecord(p0, "contenidos", "202520").state, "Apropia");
  const now = getRecord(p1, "cuestionarios", "202520");
  assert.deepEqual([now.condition, now.previousState, now.sustainedPeriods], ["dato", "Adopta", 0]);
});

test("R3: each Sin información carries its case and its label", () => {
  const trial = getRecord(p0, "debates", "202520");
  assert.deepEqual([trial.state, trial.condition, stateLabel(trial)], ["Sin información", "regla", "Regla pendiente para este caso"]);
  assert.equal(stateLabel(getRecord(p1, "cuestionarios", "202520")), "Sin información suficiente");
  for (const id of ["anuncios", "lockdown", "feedbackfruits"]) assert.equal(stateLabel(getRecord(p0, id, "202520")), "Solo configuración");
  const summary = summarize(getRecords({ tool: "debates" }));
  assert.equal(summary.conditions.regla, summary.states["Sin información"]);
  assert.equal(summarize(getRecords({ tool: "feedbackfruits" })).conditions.configuracion, 3);
});

test("R4: new teachers keep their state and the reason says how much history there is", () => {
  assert.deepEqual([getRecord(p3, "rubricas", "202310").taughtSemesters, getRecord(p3, "rubricas", "202520").taughtSemesters, getRecord(p1, "rubricas", "202520").taughtSemesters], [1, 4, 7]);
  assert.equal(getRecord(p3, "rubricas", "202310").state, "No expuesto");
  assert.equal(getRecord(p1, "rubricas", "202520").reason, "Sin uso efectivo en los 7 semestres que dictó desde 2021-2.");
  assert.equal(getRecord(p0, "actividades", "202520").reason, "Sin uso efectivo en los 9 semestres que dictó desde 2021-2. La tuvo configurada en 9 semestres, sin actividad de estudiantes.");
});

test("R5: filters, lists and the CSV use the faculty of each semester", () => {
  assert.equal(getRecord(p1, "rubricas", "202320").faculty, "Ingeniería");
  assert.equal(getRecord(p1, "rubricas", "202520").faculty, "Ciencias");
  assert.equal(professor(p1).faculty, "Ciencias", "the professor keeps the last faculty");
  assert.deepEqual(ids({ period: "202320", faculty: "Ingeniería" }), [p0, p1]);
  assert.deepEqual(ids({ period: "202520", faculty: "Ingeniería" }), [p0]);
  assert.ok(FACULTIES.includes("Educación"), "a past faculty can be filtered even if it is nobody's last one");
  assert.equal(getRecord(p3, "rubricas", "202520").faculty, "Sin facultad registrada");
  assert.equal(facultyAt(professor(p3), "202420"), "Educación", "a semester without teaching uses the last one taught");
  assert.equal(facultyAt(professor(p3), "202220"), "Sin facultad registrada", "before the first semester taught, the last faculty");
});

test("R6: groups are read from the previous taught semester", () => {
  assert.deepEqual([p0, p1, p3].map(id => getRecord(id, "rubricas", "202520").originGroup), ["C2", "C4", "C3"]);
  assert.equal(getRecord(p3, "rubricas", "202310").originGroup, null, "first semester taught");
  assert.equal(originGroup(professor(p1), "202320"), "C3", "a semester without teaching is skipped");
  assert.deepEqual(ids({ period: "202520", group: "C4" }), [p1], "not the teacher whose 2025-2 group is C4");
  assert.equal(professor(p3).groupByPeriod["202520"], "C4");
});

test("R7: forecasts show at the origin whatever the state, in bands relative to the habitual rate", () => {
  const trial = getRecord(p0, "debates", "202520");
  assert.deepEqual([trial.state, trial.probability], ["Sin información", 0.16]);
  const configurationOnly = getRecord(p1, "anuncios", "202520");
  assert.deepEqual([configurationOnly.probability, configurationOnly.forecastReason], [0.47, "La configuró en 6 semestres anteriores (desde 2020-2)."]);
  assert.deepEqual([getRecord(p0, "rubricas", "202510").probability, getRecord(p0, "rubricas", "202510").forecastReason], [null, null]);
  assert.equal(habitualRate("rubricas"), 0.2);
  assert.equal(formatDoubleRate("rubricas"), "40\u00a0%", "the label shows the cut the bands use");
  assert.deepEqual([ids({ tool: "rubricas", probability: "Baja" }), ids({ tool: "rubricas", probability: "Media" }), ids({ tool: "rubricas", probability: "Alta" })], [[p1], [p3], [p0]]);
  assert.equal(ids({ tool: "rubricas", probability: "Con estimación" }).length, 3);
  assert.equal(probabilityBandFor("rubricas", 0.1996), "Media", "20 % shown next to a habitual 20 % is not below it");
  assert.equal(TEXTS.bands.Alta, "Más del doble de lo habitual");
  const feedback = TOOLS.find(tool => tool.id === "feedbackfruits")!;
  assert.equal(feedback.forecast, false);
  assert.equal(habitualRate("feedbackfruits"), null);
  assert.ok(getRecords({ tool: "feedbackfruits" }).every(record => record.probability === null));
});

test("R8 and R9: search matches only the code, and small bases give no percent", () => {
  assert.deepEqual(ids({ search: "planta" }), []);
  assert.deepEqual(ids({ search: "0A1B" }), [p0]);
  assert.deepEqual(share(2, 3), { ratio: null, text: "2 de 3 · pocos profesores" });
});

test("R10: the CSV keeps the last taught state for whoever did not teach, and configuration-only tools say sí/no", () => {
  const csv = exportSelectionCsv({ [p3]: ["rubricas"], [p2]: ["feedbackfruits", "rubricas", "lockdown"], [p1]: ["debates"] }, "202520");
  const rows = csv.slice(1).trim().split("\r\n").slice(1);
  assert.deepEqual(rows.map(row => row.split(";")[1]), [`"${p1}"`, `"${p2}"`, `"${p3}"`], "code order");
  assert.ok(rows[0].includes('"Ciencias";') && rows[0].includes('"Debates: No expuesto";'));
  assert.ok(rows[1].includes('"Artes y Humanidades";'));
  assert.ok(rows[1].includes('"Rúbricas: Abandona (último semestre dictado: 2024-2) | LockDown: configurada en 2024-2: no | FeedbackFruits: configurada en 2024-2: sí";'));
  assert.ok(rows[2].includes('"Sin facultad registrada";'));
  const gap = exportSelectionCsv({ [p1]: ["debates"] }, "202310");
  assert.ok(gap.includes('"Ingeniería";') && gap.includes('"Debates: No expuesto (último semestre dictado: 2022-1)";'));
  assert.equal(selectionState(p3, "rubricas", "202220"), "no había dictado hasta 2022-2");
  assert.equal(selectionState(p0, "feedbackfruits", "202410"), "configurada en 2024-1: sin dato");
  // The name says the semester of the workshop and the one of the data; one workshop puts its tool first.
  assert.equal(TEXTS.csvName("202520"), "convocatoria-conectate-taller-2026-1-datos-2025-2.csv");
  assert.equal(TEXTS.csvName("202520", "rubricas"), "convocatoria-rubricas-taller-2026-1-datos-2025-2.csv");
  // The reason for each invitation travels with the file: why the state, what to talk about, the probability and its antecedent.
  const header = csv.slice(1).split("\r\n")[0];
  assert.ok(header.endsWith('"Por qué está en ese estado";"Qué conversar (sugerencia inicial)";"Probabilidad de configurarla en 2026-1 (si vuelve a dictar, no mide si el taller le servirá)";"Antecedente de la probabilidad";"Nota";"Cupo escrito en el tablero"'));
  const cells = (row: string) => row.slice(1, -1).split('";"');
  const [why, talk, chance, antecedent, note, quota] = cells(rows[0]).slice(-6);
  assert.ok(why.startsWith("Debates: Ninguno de sus estudiantes la ha usado"));
  assert.equal(talk, "Debates: Explorar un primer acercamiento");
  assert.match(chance, /^Debates: (\d|menos de|ya la tiene|sin probabilidad)/);
  assert.match(antecedent, /^Debates: /);
  assert.equal(note, "");
  assert.equal(quota, "");
  // Without the list it was marked from (a reload loses it), the criterion says so.
  assert.match(cells(rows[0])[8], /^Elegido en el tablero \(sin la lista: se marcó antes de recargar la página o de cambiar de archivo\)/);
  const [, talk2, chance2] = cells(rows[1]).slice(-6);
  assert.equal(talk2, "Rúbricas: Conversar sobre la interrupción | LockDown: sin sugerencia (de esta herramienta solo hay datos de configuración) | FeedbackFruits: sin sugerencia (de esta herramienta solo hay datos de configuración)", "configuration-only tools get no guidance, and the cell says so");
  assert.ok(chance2.includes("LockDown: solo hay pronóstico con datos de 2025-2"), "no forecast outside its origin, never 0");
  assert.ok(chance2.includes("FeedbackFruits: sin pronóstico para esta herramienta"));
  // The list each person was marked from, the note and both dates travel too.
  const marked = exportSelectionCsv({ [p1]: ["debates"] }, "202520", { criteria: { [`${p1}:debates`]: "lista «No expuesto · 2025-2»" }, note: "desempate por facultad", date: new Date(2026, 10, 19), capacity: { debates: 25, rubricas: 9 }, total: 30 });
  const [row] = marked.slice(1).trim().split("\r\n").slice(1).map(cells);
  assert.equal(row[8], "Elegido en el tablero (Debates: lista «No expuesto · 2025-2»); falta confirmar con el profesor que el taller le sirve");
  assert.match(row[9], /datos generados el .+ · lista descargada el 2026-11-19$/);
  assert.equal(row.at(-2), "desempate por facultad");
  // The quota written in the dashboard travels too, only for this person's workshops.
  assert.equal(row.at(-1), "Debates: 25 | total de la convocatoria: 30");
});

test("one workshop downloads in the order of «Por taller»: highest probability first, the rest by code", () => {
  const people = [p0, p1, p2, p3];
  const rows = exportSelectionCsv(Object.fromEntries(people.map(id => [id, ["rubricas"]])), "202520").slice(1).trim().split("\r\n").slice(1);
  const chance = (id: string) => { const at = PROFESSORS.find(p => p.id === id)!.periods.filter(p => p <= "202520").at(-1); return at ? getRecord(id, "rubricas", at).probability ?? -1 : -1; };
  const expected = [...people].sort((a, b) => chance(b) - chance(a) || a.localeCompare(b));
  assert.deepEqual(rows.map(row => row.split(";")[1]), expected.map(id => `"${id}"`));
  assert.ok(people.some(id => chance(id) >= 0), "the fixture has someone with a probability");
});

test("R11: reach and shared classrooms reach the record", () => {
  assert.deepEqual([p0, p1, p3].map(id => getRecord(id, "rubricas", "202520").observation.shared), [false, true, null]);
  assert.equal(getRecord(p0, "contenidos", "202520").observation.reach, 0.59);
});
