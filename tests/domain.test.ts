import test from "node:test";
import assert from "node:assert/strict";
import { setSource } from "../src/lib/data";
import { activeRun, classify, exportSelectionCsv, formatPeriod, formatProbability, getRecord, getRecords, plainReason, probabilityBandFor, share, stateLabel, summarize } from "../src/lib/domain";
import type { Observation } from "../src/lib/types";
import * as sintetico from "./sintetico";
import { FACULTIES, GROUPS, OBSERVATIONS, PERIODS, PROFESSORS, TOOLS, VALIDATION_ROWS } from "./sintetico";

setSource(sintetico);

const tool = TOOLS.find(item => item.id === "rubricas")!;
function history(effective: Array<boolean | null>, intensity = 0.5): Observation[] {
  return effective.map((value, i) => ({ professorId: "test", toolId: tool.id, period: PERIODS[i], effective: value, configured: value === null ? null : value, reach: value ? 0.6 : value === null ? null : 0, intensity: value ? intensity : value === null ? null : 0, shared: null }));
}

test("framework distinguishes first use, sustained use, appropriation and cessation", () => {
  assert.equal(classify(history([false, false, false]), tool).state, "No expuesto");
  assert.equal(classify(history([false, false, true]), tool).state, "Adopta");
  assert.equal(classify(history([false, true, true]), tool).state, "Usa");
  assert.equal(classify(history([false, true, true], tool.threshold + 0.1), tool).state, "Apropia");
  assert.equal(classify(history([false, true, true], tool.threshold), tool).state, "Usa", "threshold is strict, not >=");
  assert.equal(classify(history([false, true, true, false, false]), tool).state, "Abandona");
});

test("median and consecutive effective periods determine appropriation", () => {
  const rows = history([false, true, true, true]);
  rows[1].intensity = 0.2;
  rows[2].intensity = tool.threshold + 0.1;
  rows[3].intensity = 20;
  assert.equal(classify(rows, tool).state, "Apropia");
  rows[2].intensity = 0.3;
  assert.equal(classify(rows, tool).state, "Usa", "a single extreme does not imply appropriation");
  rows[2].intensity = null;
  assert.equal(classify(rows, tool).state, "Usa", "known sustained use remains visible without enough intensity");
});

test("configuration alone is not effective use; unresolved histories abstain", () => {
  const configuredOnly = history([false, false, false]);
  configuredOnly.forEach(row => { row.configured = true; });
  assert.equal(classify(configuredOnly, tool).state, "No expuesto");
  assert.equal(classify(history([false, true, false]), tool).state, "Sin información", "isolated experiment is not abandonment");
  assert.equal(classify(history([true, true, false, true]), tool).state, "Sin información", "reactivation has no defined state");
  // Decision #3: a semester without data is skipped like one without teaching, so this run is Usa.
  assert.equal(classify(history([false, null, true, true]), tool).state, "Usa");
  assert.equal(classify(history([false, false, false]).slice(1), tool).state, "Sin información", "left-truncated history is not never exposed");
  const missingCalendarPeriod = history([false, false, false]);
  missingCalendarPeriod.splice(1, 1);
  assert.equal(classify(missingCalendarPeriod, tool).state, "Sin información");
  assert.equal(classify([], tool).state, "Sin información");
});

test("synthetic dataset has unique keys, all states and distinguishable missing data", () => {
  assert.equal(PROFESSORS.length, 96);
  assert.equal(new Set(PROFESSORS.map(item => item.id)).size, 96);
  assert.equal(new Set(PROFESSORS.map(item => item.name)).size, 96);
  assert.equal(OBSERVATIONS.length, 96 * 7 * 5);
  assert.equal(new Set(OBSERVATIONS.map(row => `${row.professorId}:${row.toolId}:${row.period}`)).size, OBSERVATIONS.length);
  assert.equal(GROUPS.length, 5);
  assert.ok(FACULTIES.length > 1);
  for (const item of TOOLS) {
    const records = getRecords({ tool: item.id });
    assert.equal(records.length, 96);
    const states = new Set(records.map(record => record.state));
    assert.deepEqual(states, new Set(["No expuesto", "Adopta", "Usa", "Apropia", "Abandona", "Sin información"]));
    assert.ok(records.some(record => record.observation.configured === null));
  }
});

test("descriptive groups agree with observed configurations without implying unknown values are zero", () => {
  const currentMembership = new Set(PROFESSORS.map(professor => professor.groupByPeriod["202520"]));
  assert.deepEqual(currentMembership, new Set(GROUPS.map(group => group.id)), "all five groups have current members");
  for (const professor of PROFESSORS) for (const period of PERIODS) {
    const rows = OBSERVATIONS.filter(row => row.professorId === professor.id && row.period === period);
    const configured = rows.filter(row => row.configured === true);
    const group = professor.groupByPeriod[period];
    if (group === "g2") assert.ok(configured.length <= 2, "sparse means at most two observed configurations");
    if (group === "g1") assert.ok(configured.length >= 5, "diverse means at least five observed configurations");
    if (group === "g4") {
      assert.equal(rows.find(row => row.toolId === "rubricas")?.configured, true);
      assert.ok(configured.length === 3 || configured.length === 4);
    }
    if (group === "g0") {
      assert.ok(configured.some(row => row.toolId === "cuestionarios" || row.toolId === "calificaciones"));
      assert.ok(!configured.some(row => row.toolId === "rubricas"), "the label excludes observed rubric configuration");
    }
    if (group === "g3") {
      assert.ok(configured.filter(row => ["contenidos", "actividades", "anuncios"].includes(row.toolId)).length >= 2, "materials and communication dominate this combination");
      assert.ok(configured.every(row => ["contenidos", "actividades", "anuncios", "debates"].includes(row.toolId)));
    }
  }
  assert.ok(OBSERVATIONS.some(row => row.configured === null), "group assignment preserves missing observations");
});

test("aggregate denominators reconcile and probability never substitutes missing or observed use", () => {
  const records = getRecords();
  const summary = summarize(records);
  assert.equal(summary.total, 96);
  assert.equal(summary.uniqueProfessors, 96);
  assert.equal(Object.values(summary.states).reduce((sum, n) => sum + n, 0), 96);
  assert.ok(summary.configured <= summary.measurable && summary.measurable < summary.total);
  assert.ok(summary.expectedStarts <= summary.eligible);
  for (const record of records) if (record.probability !== null) {
    assert.equal(record.observation.configured, false);
    assert.ok(record.probability >= 0 && record.probability <= 1);
  }
  // Decision #15: the forecast is about starting to configure, so the state does not hide it.
  assert.ok(records.some(record => record.probability !== null && record.state === "Sin información"));
  const example = records[0];
  assert.equal(getRecord(example.professor.id, example.tool.id, example.period), example);
  assert.equal(getRecord(example.professor.id, example.tool.id, "202320").history.length, 1);
});

test("filters preserve the period's nominal membership and probability bands partition eligibility", () => {
  const base = getRecords();
  const bands = ["Baja", "Media", "Alta"] as const;
  const eligible = base.filter(record => record.probability !== null);
  const filtered = bands.flatMap(probability => getRecords({ probability }));
  assert.deepEqual(new Set(filtered.map(record => record.professor.id)), new Set(eligible.map(record => record.professor.id)));
  assert.equal(filtered.length, eligible.length);
  assert.ok(bands.every(probability => getRecords({ probability }).length > 0));
  // Decision #9: the group filter uses the group of origin (previous taught semester), not the same semester's.
  for (const group of GROUPS) assert.equal(getRecords({ group: group.id }).length, base.filter(record => record.professor.groupByPeriod["202510"] === group.id).length);
  const professor = PROFESSORS.find(item => item.name.includes("Cárdenas"))!;
  assert.ok(getRecords({ search: "cardenas" }).some(record => record.professor.id === professor.id));
});

test("validation uses binary synthetic configuration opportunities at the declared arrival periods", () => {
  assert.ok(VALIDATION_ROWS.length > 100);
  assert.deepEqual(new Set(VALIDATION_ROWS.map(row => row.period)), new Set(["202510", "202520"]));
  for (const item of TOOLS) {
    const rows = VALIDATION_ROWS.filter(row => row.toolId === item.id);
    assert.ok(rows.some(row => row.outcome) && rows.some(row => !row.outcome));
    assert.ok(rows.every(row => row.probability >= 0 && row.probability <= 1));
  }
});

test("CSV exports one row per professor, deduplicates tools, preserves accents and quotes dangerous cells", () => {
  const professor = PROFESSORS[0];
  const originalName = professor.name;
  try {
    professor.name = '=HYPERLINK("x";"y")';
    const csv = exportSelectionCsv({ [professor.id]: ["rubricas", "rubricas", "debates"], unknown: ["rubricas"] });
    assert.ok(csv.startsWith("\uFEFF"));
    const rows = csv.slice(1).trim().split("\r\n");
    assert.equal(rows.length, 2);
    assert.ok(rows[0].includes('"Profesor (código seudónimo)";"Código";"Facultad";"Nombre de la facultad"'));
    assert.ok(rows[1].startsWith('"\'=HYPERLINK(""x"";""y"")";'));
    assert.ok(rows[1].includes('"Rúbricas | Debates";'), "selected tools are deduplicated in their own column");
    assert.ok(rows[0].includes('"Semestre consultado";"Estados por herramienta";"Criterio"'));
    assert.ok(rows[1].includes('"2025-2";'));
    assert.ok(rows[1].includes("Datos sintéticos"));
    assert.ok(!csv.includes("unknown"));
  } finally { professor.name = originalName; }
  assert.equal(exportSelectionCsv({ [professor.id]: [] }).trim().split("\r\n").length, 1);
  assert.equal(formatPeriod("202520"), "2025-2");
  assert.equal(formatPeriod("202610"), "2026-1");
});

test("a missing semester gets no state but does not cut the run, and each Sin información has its case", () => {
  const run = history([true, null, true]);
  const result = classify(run, tool);
  assert.equal(result.state, "Usa");
  assert.equal(result.sustainedPeriods, 2, "the missing semester neither cuts nor counts");
  assert.equal(result.condition, null);
  assert.match(result.reason, /Un semestre no tiene dato de uso efectivo/);
  const missingNow = classify(history([true, true, null]), tool);
  assert.deepEqual([missingNow.state, missingNow.condition, missingNow.sustainedPeriods], ["Sin información", "dato", 0]);
  assert.equal(classify(history([false, true, false]), tool).condition, "regla");
  assert.equal(classify(history([true, true, false, true]), tool).condition, "regla");
  assert.equal(stateLabel(classify(history([false, true, false]), tool)), "Regla pendiente para este caso");
  assert.equal(stateLabel(missingNow), "Sin información suficiente");
  assert.equal(stateLabel(classify(history([true, true]), tool)), "Usa");
  const configuredOnly = history([false, false]);
  configuredOnly[1].configured = true;
  assert.match(classify(configuredOnly, tool).reason, /La tuvo configurada en 1 semestre, sin actividad de estudiantes\./);
  const records = getRecords();
  const summary = summarize(records);
  assert.equal(summary.conditions.regla + summary.conditions.dato + summary.conditions.configuracion, summary.states["Sin información"]);
  assert.ok(summary.conditions.regla > 0 && summary.conditions.dato > 0);
  for (const record of records) assert.equal(record.condition !== null, record.state === "Sin información");
  const withRun = records.find(record => record.sustainedPeriods >= 2)!;
  assert.deepEqual(activeRun(withRun), withRun.history.slice(-withRun.sustainedPeriods));
});

test("probabilities are shown with one decimal under 10 % and bands use the shown number", () => {
  assert.equal(formatProbability(0.42), "42\u00a0%");
  assert.equal(formatProbability(0.042), "4,2\u00a0%");
  assert.equal(formatProbability(0.0996), "10\u00a0%");
  assert.equal(formatProbability(0.001), "0,1\u00a0%");
  assert.equal(formatProbability(0.0004), "menos de 0,1\u00a0%");
  // Juan's synthetic 35 / 65 cuts, applied to the rounded value the table shows.
  assert.equal(probabilityBandFor("rubricas", 0.6496), "Alta");
  assert.equal(probabilityBandFor("rubricas", 0.3449), "Baja");
  assert.equal(probabilityBandFor("rubricas", 0.35), "Media");
  const candidates = getRecords({ probability: "Con estimación" });
  assert.equal(candidates.length, getRecords().filter(record => record.probability !== null).length);
  assert.ok(candidates.every(record => record.forecastReason !== null));
});

test("percentages need at least 30 professors in the base", () => {
  assert.deepEqual(share(12, 40), { ratio: 0.3, text: "30\u00a0%" });
  assert.deepEqual(share(3, 29), { ratio: null, text: "3 de 29 · pocos profesores" });
  assert.deepEqual(share(0, 0), { ratio: null, text: "—" });
});

test("plain reasons follow the branch that decided the state, and the configured filter splits sí, no and sin dato", () => {
  assert.equal(classify(history([false, true, false]), tool).cause, "ensayo");
  assert.equal(classify(history([true, true, false, true]), tool).cause, "retomo");
  const records = TOOLS.flatMap(item => getRecords({ tool: item.id }));
  const reason = (cause: string) => plainReason(records.find(record => record.cause === cause)!);
  assert.match(reason("ensayo"), /nunca 2 semestres seguidos/);
  assert.match(reason("retomo"), /Volvió a usarla después de dejarla/);
  assert.match(reason("no-expuesto"), new RegExp(`desde ${formatPeriod(PERIODS[0])}`));
  const parts = (["si", "no", "sin-dato"] as const).map(configured => getRecords({ configured }).length);
  assert.ok(parts.every(n => n > 0));
  assert.equal(parts.reduce((sum, n) => sum + n, 0), getRecords().length);
});
