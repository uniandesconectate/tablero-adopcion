import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fixture from "./fixtures/tablero-ejemplo.json";
import { setSource } from "../src/lib/data";
import { classify } from "../src/lib/domain";
import { buildRealSource } from "../src/lib/real";
import type { Observation } from "../src/lib/types";
import * as sintetico from "./sintetico";

// `real` is the fixture as the start screen opens it; domain.ts runs on the synthetic test data.
const real = { ...buildRealSource(fixture), buildRealSource };
setSource(sintetico);
const { PERIODS } = sintetico;
const rubricas = sintetico.TOOLS.find(item => item.id === "rubricas")!;
const [p0, p1, p2, p3, p4] = PERIODS;
function rows(periods: string[], effective: boolean[], toolId = rubricas.id): Observation[] {
  return periods.map((period, i) => ({ professorId: "test", toolId, period, configured: effective[i], effective: effective[i], reach: effective[i] ? 0.6 : 0, intensity: effective[i] ? 0.5 : 0, shared: null }));
}

test("a semester without teaching is neither missing data nor a stop", () => {
  const taught = [p0, p1, p3];
  assert.equal(classify(rows(taught, [false, false, false]), rubricas, taught).state, "No expuesto");
  const acrossGap = classify(rows(taught, [true, true, true]), rubricas, taught).state;
  assert.equal(acrossGap, "Usa", "use before and after the gap is one run, not a reactivation or a stop");
  assert.equal(classify(rows(taught, [true, true, true]), rubricas).state, "Sin información", "against the calendar the gap reads as missing data");
});

test("consecutive use counts taught semesters and skips the ones without teaching", () => {
  const taught = [p0, p2, p4];
  const result = classify(rows(taught, [false, true, true]), rubricas, taught);
  assert.equal(result.state, "Usa");
  assert.equal(result.sustainedPeriods, 2);
  assert.equal(classify(rows(taught, [true, true, false]), rubricas, taught).state, "Abandona", "stopping in a taught semester is still Abandona");
});

test("a configuration-only tool gets Sin información with its reason", () => {
  assert.deepEqual(real.TOOLS.filter(item => item.evidence === "configuracion").map(item => item.id), ["anuncios", "lockdown", "turnitin", "padlet", "genially", "voicethread", "feedbackfruits"]);
  const anuncios = real.TOOLS.find(item => item.id === "anuncios")!;
  const result = classify(rows(PERIODS, PERIODS.map(() => true), anuncios.id), anuncios);
  assert.equal(result.state, "Sin información");
  assert.equal(result.condition, "configuracion");
  assert.equal(result.reason, "Para esta herramienta solo hay datos de configuración: no se asigna un estado del marco.");
});

test("the real probability exists only at the forecast origin and only when the tool is not configured", () => {
  let found = 0;
  for (const professor of real.PROFESSORS) for (const tool of real.TOOLS) {
    const history = real.OBSERVATIONS.filter(row => row.professorId === professor.id && row.toolId === tool.id);
    history.forEach((row, i) => {
      if (real.startProbability(professor, tool, history.slice(0, i + 1)) === null) return;
      found++;
      assert.equal(row.period, "202520");
      assert.equal(row.configured, false);
    });
  }
  assert.equal(found, fixture.pronosticos.prob.length, "every forecast row shows at its origin");
  const professor = real.PROFESSORS.find(item => item.id === "D-0a1b2c3d")!;
  const tool = real.TOOLS.find(item => item.id === "rubricas")!;
  const history = real.OBSERVATIONS.filter(row => row.professorId === professor.id && row.toolId === tool.id);
  assert.equal(real.startProbability(professor, tool, history), 0.42);
  assert.equal(real.startProbability(professor, tool, history.slice(0, -1)), null, "an earlier semester has no forecast");
  assert.equal(real.startProbability(professor, tool, [...history.slice(0, -1), { ...history.at(-1)!, configured: true }]), null, "a configured tool has no forecast");
});

test("the adapter keeps only taught semesters, in calendar order, and unknown values as unknown", () => {
  const professor = real.PROFESSORS.find(item => item.id === "D-3f4e5d6c")!;
  assert.deepEqual(professor.periods, ["202120", "202210", "202320", "202410", "202420", "202510", "202520"]);
  assert.equal(professor.groupByPeriod["202220"], undefined);
  assert.equal(professor.name, professor.id, "a pseudonymous code is never replaced by an invented name");
  assert.equal(professor.department, "Contrato: Cátedra");
  for (const teacher of real.PROFESSORS) for (const tool of real.TOOLS) {
    const periods = real.OBSERVATIONS.filter(row => row.professorId === teacher.id && row.toolId === tool.id).map(row => row.period);
    assert.deepEqual(periods, teacher.periods);
  }
  assert.equal(real.OBSERVATIONS.find(row => row.toolId === "lockdown" && row.period === "202120")?.configured, null, "an unavailable external tool is unknown, not zero");
  assert.ok(real.FACULTIES.includes("Sin facultad registrada"));
  assert.equal(real.nextGroupProbabilities("D-0a1b2c3d", "202520")?.length, 5);
  assert.equal(real.nextGroupProbabilities("D-0a1b2c3d", "202510"), null, "the next-group forecast exists only at its origin");
});

test("the adapter rejects a wrong contract version, duplicate ids and misaligned columns", () => {
  assert.throws(() => real.buildRealSource({ ...fixture, contrato: "tablero-adopcion/v1" }), /tablero-adopcion\/v2/, "only v2 is accepted");
  assert.throws(() => real.buildRealSource(null), /tablero-adopcion\/v2/);
  assert.throws(() => real.buildRealSource({ ...fixture, uso: undefined }), /le falta una parte: está incompleto o viene de otro proceso/);
  const duplicated = structuredClone(fixture);
  duplicated.profesores.id[1] = duplicated.profesores.id[0];
  assert.throws(() => real.buildRealSource(duplicated), /id repetido/);
  const misaligned = structuredClone(fixture);
  misaligned.uso.rubricas.efectiva.pop();
  assert.throws(() => real.buildRealSource(misaligned), /mismo largo/);
  const noFaculty = structuredClone(fixture);
  noFaculty.filas.facultad.pop();
  assert.throws(() => real.buildRealSource(noFaculty), /mismo largo/);
});

test("the adapter reads the v2 fields: faculty and shared classrooms per row, tools without a model, rules and return share", () => {
  assert.deepEqual(real.SELECTABLE_PERIODS, ["202220", "202310", "202320", "202410", "202420", "202510", "202520"]);
  assert.equal(real.MIN_PROFESSORS, 30);
  assert.equal(real.RETURN_SHARE, 0.8);
  const professor = real.PROFESSORS.find(item => item.id === "D-3f4e5d6c")!;
  assert.deepEqual([professor.facultyByPeriod["202320"], professor.facultyByPeriod["202410"], professor.faculty], ["Ingeniería", "Ciencias", "Ciencias"]);
  assert.equal(real.OBSERVATIONS.find(row => row.professorId === professor.id && row.period === "202520")?.shared, true);
  const feedback = real.TOOLS.find(item => item.id === "feedbackfruits")!;
  assert.deepEqual([feedback.forecast, feedback.evidence, feedback.threshold], [false, "configuracion", null]);
  const feedbackRows = real.OBSERVATIONS.filter(row => row.toolId === "feedbackfruits");
  assert.ok(feedbackRows.every(row => row.period >= "202420" ? row.configured !== null : row.configured === null), "unavailable before 2024-2, not zero");
  const history = real.OBSERVATIONS.filter(row => row.professorId === "D-0a1b2c3d" && row.toolId === "debates");
  assert.equal(real.startReason(real.PROFESSORS[0], real.TOOLS.find(item => item.id === "debates")!, history), "La configuró en 1 semestre anterior (desde 2020-2).");
  assert.ok(!fixture.pronosticos.razon.some(text => text.includes("retoma")));
});

test("the adapter rejects forecasts without a habitual rate, a tool without a model that has forecasts, and a bad first semester", () => {
  const noStarts = structuredClone(fixture);
  noStarts.validacion.empezo = noStarts.validacion.empezo.map(() => 0);
  assert.throws(() => real.buildRealSource(noStarts), /tasa habitual/);
  const feedback = fixture.herramientas.findIndex(item => item.id === "feedbackfruits");
  const forecastWithoutModel = structuredClone(fixture);
  forecastWithoutModel.pronosticos.herramienta[0] = feedback;
  assert.throws(() => real.buildRealSource(forecastWithoutModel), /no tiene modelo y trae pronósticos/);
  const validationWithoutModel = structuredClone(fixture);
  validationWithoutModel.validacion.herramienta[validationWithoutModel.validacion.empezo.indexOf(0)] = feedback;
  assert.throws(() => real.buildRealSource(validationWithoutModel), /no tiene modelo y trae filas de validación/);
  const early = structuredClone(fixture);
  early.fuente.reglas.consultable_desde = "202010";
  assert.throws(() => real.buildRealSource(early), /consultable_desde/);
});

test("real bands compare the shown probability with the tool's habitual rate", () => {
  assert.deepEqual([0.19, 0.2, 0.39, 0.4].map(p => real.probabilityBand(p, 0.2)), ["Baja", "Media", "Media", "Alta"]);
  assert.deepEqual([0.34, 0.35, 0.65].map(p => sintetico.probabilityBand(p, 0.2)), ["Baja", "Media", "Alta"], "the synthetic source keeps 35 / 65");
});

test("domain rules hold on the v2 fixture (R1 to R11)", () => {
  // domain.ts reads one open file at a time, so tests/domain-real.ts opens the fixture in its own process.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "tests/domain-real.ts"], { encoding: "utf8", env });
  assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
});

test("the synthetic test data has the same names as an opened file, so setSource can load either", () => {
  for (const name of Object.keys(sintetico)) assert.ok(name in real, `un archivo abierto no trae ${name}`);
});

test("group descriptions say what the group is, without the method's jargon", () => {
  for (const group of real.GROUPS) {
    assert.doesNotMatch(group.description, /K5|Lina|nominal/, group.id);
    assert.match(group.description, /^[A-ZÁÉÍÓÚÑ]/, `${group.id} starts with a capital`);
    assert.match(group.description, /es un nombre, no un nivel/, group.id);
  }
});
