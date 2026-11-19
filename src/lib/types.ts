// Ids are plain strings: periods, tools and groups come from the active source (see data.ts).
export type PeriodId = string;
export type ToolId = string;
export const STATES = ["Adopta", "Usa", "Apropia", "No expuesto", "Abandona"] as const;
export type AdoptionState = (typeof STATES)[number] | "Sin información";
/** Why a record is "Sin información"; each case has its own count and stays out of percentages. */
export const CONDITION_LABELS = { regla: "Regla pendiente para este caso", dato: "Sin información suficiente", configuracion: "Solo configuración" } as const;
export type Condition = keyof typeof CONDITION_LABELS;
/** Probability bands from low to high; each source sets the cuts (probabilityBand) and labels (TEXTS.bands). */
export const BANDS = ["Baja", "Media", "Alta"] as const;
export type ProbabilityBand = (typeof BANDS)[number];
export type GroupId = string;
export type ViewId = "resumen" | "herramientas" | "profesores" | "grupos" | "predicciones";
export interface Tool {
  id: ToolId;
  name: string;
  description: string;
  threshold: number | null;
  workshop: string;
  /** "configuracion": only configuration is known, so no framework state is assigned. */
  evidence?: "uso" | "configuracion";
  /** false: the model has no forecast for this tool; absent means it has one. */
  forecast?: boolean;
}
export interface Group { id: GroupId; name: string; description: string; }
export interface Professor {
  id: string;
  name: string;
  initials: string;
  /** Faculty of the last semester taught; use facultyAt() for a given semester. */
  faculty: string;
  facultyByPeriod: Record<PeriodId, string>;
  department: string;
  groupByPeriod: Record<PeriodId, GroupId>;
  /** Semesters the professor taught, in calendar order. */
  periods: PeriodId[];
}
export interface Observation {
  professorId: string;
  toolId: ToolId;
  period: PeriodId;
  configured: boolean | null;
  effective: boolean | null;
  reach: number | null;
  intensity: number | null;
  /** true when every classroom of the teacher that semester is co-taught; null when unknown. */
  shared: boolean | null;
}
export interface TeacherToolRecord {
  professor: Professor;
  tool: Tool;
  period: PeriodId;
  state: AdoptionState;
  /** Set only when state is "Sin información": the case behind it. */
  condition: Condition | null;
  previousState: AdoptionState | null;
  observation: Observation;
  history: Observation[];
  probability: number | null;
  /** Configuration background that comes with the forecast; null without forecast. */
  forecastReason: string | null;
  reason: string;
  sustainedPeriods: number;
  firstEffectivePeriod: PeriodId | null;
  /** Semesters the teacher taught up to and including this one. */
  taughtSemesters: number;
  /** Faculty in this semester. */
  faculty: string;
  /** Group in the previous taught semester; null when this is the first one. */
  originGroup: GroupId | null;
}
export interface Filters {
  period: PeriodId;
  faculty: string;
  tool: ToolId;
  state: AdoptionState | "Todos";
  group: GroupId | "Todos";
  search: string;
  /** "Con estimación": every teacher with a forecast, in any band. */
  probability: "Todas" | ProbabilityBand | "Con estimación";
}
export interface ValidationRow { toolId: ToolId; period: PeriodId; probability: number; outcome: boolean; }
export interface PageProps {
  filters: Filters;
  onFilters: (patch: Partial<Filters>) => void;
  onNavigate: (view: ViewId, patch?: Partial<Filters>) => void;
  onProfessor: (record: TeacherToolRecord) => void;
  onMethod: () => void;
}
export type Selection = Record<string, ToolId[]>;
