import type { buildRealSource } from "./real";

/** What the dashboard reads from a valid tablero.json (see real.ts). */
export type Source = ReturnType<typeof buildRealSource>;
// Empty until a file is opened on the start screen: the app ships without data.
export let { DATA_SOURCE, PERIODS, SELECTABLE_PERIODS, MIN_PROFESSORS, RETURN_SHARE, SELECTION_KEY, TEXTS, TOOLS, GROUPS, FACULTIES, PROFESSORS, OBSERVATIONS, VALIDATION_ROWS, startProbability, startReason, probabilityBand, nextGroupProbabilities } = {} as Source;

const derived: Array<() => void> = [];
/** Modules with values taken from the file register how to recompute them; they run on every load (and now, if a file is open). */
export function onSource(derive: () => void) {
  derived.push(derive);
  if (TOOLS) derive();
}
export function setSource(source: Source) {
  ({ DATA_SOURCE, PERIODS, SELECTABLE_PERIODS, MIN_PROFESSORS, RETURN_SHARE, SELECTION_KEY, TEXTS, TOOLS, GROUPS, FACULTIES, PROFESSORS, OBSERVATIONS, VALIDATION_ROWS, startProbability, startReason, probabilityBand, nextGroupProbabilities } = source);
  for (const derive of derived) derive();
}
