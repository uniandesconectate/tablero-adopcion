"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { GROUPS, RETURN_SHARE, TEXTS, TOOLS, VALIDATION_ROWS } from "@/lib/data";
import { formatPeriod, formatDoubleRate, formatProbability, getRecords, habitualRate, probabilityBandFor, share, stateLabel } from "@/lib/domain";
import {
  BANDS,
  STATES,
  type AdoptionState,
  type Filters,
  type PageProps,
  type PeriodId,
  type ProbabilityBand,
  type TeacherToolRecord,
  type ValidationRow,
} from "@/lib/types";
import { EmptyState, Icon, Metric, OffOrigin, SectionHeading, StateBadge, StateBars, offOrigin, pct, plural } from "@/components/ui";

// Groups were built from the configuration of these tools (LockDown and Turnitin live inside quizzes and activities).
const CIRCULAR = new Set(["contenidos", "actividades", "anuncios", "calificaciones", "cuestionarios", "rubricas", "debates", "lockdown", "turnitin"]);
// Below this many observed starts, validation figures are fragile (decision #17).
const FEW_STARTS = 30;

const decimal = (value: number, digits = 1) => new Intl.NumberFormat("es-CO", {
  minimumFractionDigits: 0,
  maximumFractionDigits: digits,
}).format(value);

const barStyle = (value: number): CSSProperties => ({ "--bar-width": `${Math.min(100, Math.max(0, value * 100))}%` } as CSSProperties);

function toolSelect(filters: Filters, onFilters: PageProps["onFilters"]) {
  return <label className="field">Herramienta
    <select value={filters.tool} onChange={event => onFilters({ tool: event.target.value as Filters["tool"] })}>
      {TOOLS.map(tool => <option value={tool.id} key={tool.id}>{tool.name}</option>)}
    </select>
  </label>;
}

function PersonButton({ record, onProfessor }: { record: TeacherToolRecord; onProfessor: PageProps["onProfessor"] }) {
  return <button className="person-cell inline-link" onClick={() => onProfessor(record)}>
    <span className="avatar" aria-hidden="true">{record.professor.initials}</span>
    <span><strong>{record.professor.name}</strong><span className="muted">{record.faculty}</span></span>
  </button>;
}

export function GroupsPage({ filters, onFilters, onNavigate, onProfessor, onMethod }: PageProps) {
  const activeState = STATES.find(state => state === filters.state) ?? "Adopta";
  const tool = TOOLS.find(item => item.id === filters.tool)!;
  const records = getRecords({
    period: filters.period,
    faculty: filters.faculty,
    tool: filters.tool,
    state: "Todos",
    group: "Todos",
    search: "",
    probability: "Todas",
  });
  // Keep the state shown here in the filters, so a hidden «Sin información» does not reach Profesores.
  useEffect(() => { if (filters.state !== activeState) onFilters({ state: activeState }); }, [filters.state, activeState, onFilters]);
  const configOnly = tool.evidence === "configuracion";
  // Configuration-only tools compare «configured» over teachers with a known value; the rest compare a state over evaluable teachers.
  const counted = (record: TeacherToolRecord) => configOnly ? record.observation.configured === true : record.state === activeState;
  const inBase = (record: TeacherToolRecord) => configOnly ? record.observation.configured !== null : record.state !== "Sin información";
  const inGroup = (id: string) => records.filter(record => record.originGroup === id);
  const withoutOrigin = records.filter(record => record.originGroup === null).length;
  const selectedGroup = GROUPS.find(group => group.id === filters.group);
  const selectedRecords = selectedGroup ? inGroup(selectedGroup.id) : [];
  const selectedMembers = selectedRecords
    .filter(counted)
    .sort((a, b) => a.professor.name.localeCompare(b.professor.name, "es"));
  const groupData = GROUPS.map(group => {
    const members = inGroup(group.id);
    const base = members.filter(inBase).length;
    const count = members.filter(counted).length;
    return { group, members, base, count, unknown: members.length - base, part: share(count, base) };
  });
  const openMembers = (state: AdoptionState = activeState) => {
    if (selectedGroup) onNavigate("profesores", {
      group: selectedGroup.id,
      state: configOnly ? "Todos" : state,
      tool: filters.tool,
      search: "",
      probability: "Todas",
    });
  };
  const target = configOnly ? `con ${tool.name} configurada` : `en ${activeState}`;

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Grupos similares</p><h1 tabIndex={-1}>Distintas formas de usar la plataforma.</h1>
        <p className="muted">Compara el mismo estado de una herramienta entre grupos y revisa a sus integrantes. Cada profesor cuenta en su grupo de partida: el del semestre anterior en que dictó.</p></div>
      <button className="button button-ghost" onClick={onMethod}><Icon name="info"/>Cómo se leen los grupos</button>
    </div>

    <div className="toolbar">
      {toolSelect(filters, onFilters)}
      {!configOnly && <label className="field">Estado a comparar
        <select value={activeState} onChange={event => onFilters({ state: event.target.value as AdoptionState })}>
          {STATES.map(state => <option value={state} key={state}>{state}</option>)}
        </select>
      </label>}
      <p className="muted subgroup-note">{formatPeriod(filters.period)} · {filters.faculty === "Todos" ? "Todas las facultades" : filters.faculty} · grupo de partida</p>
    </div>

    <div className="two-column">
      <section className="panel" aria-label="Comparación de grupos">
        <SectionHeading eyebrow={tool.name} title={configOnly ? "Configurada en al menos un aula" : `Profesores en ${activeState}`}
          description={configOnly
            ? "Configuración, no uso con estudiantes: quienes la tienen configurada entre quienes dictaron con dato de configuración, dentro de cada grupo de partida (el del semestre anterior en que dictó)."
            : "Porcentaje entre quienes tienen un estado evaluable, dentro de cada grupo de partida (el del semestre anterior en que dictó). Todos los grupos usan la misma escala de 0 a 100 %."}/>
        <div className="panel-body">
          {records.length === 0 ? <EmptyState title="Sin profesores en este contexto" description="Prueba con otra facultad o herramienta."/> : <div className="bar-list">
            {groupData.map(({ group, members, base, count, unknown, part }) => <button
              className={`group-card ${selectedGroup?.id === group.id ? "is-selected" : ""}`}
              key={group.id}
              aria-pressed={selectedGroup?.id === group.id}
              onClick={() => onFilters({ group: group.id })}
              aria-label={configOnly
                ? `${group.name}: ${count} de ${base} profesores con dato la tienen configurada; ${unknown} sin dato. Ver grupo.`
                : `${group.name}: ${count} de ${base} profesores evaluables en ${activeState}; ${unknown} sin estado del marco. Ver grupo.`}
            >
              <span className="group-card-heading"><strong>{group.name}</strong><strong>{part.text}</strong></span>
              {part.ratio !== null && <span className="bar-track"><span className="bar-fill" style={barStyle(part.ratio)}/></span>}
              <span className="muted">{count}/{base} {configOnly ? `con dato · ${unknown} sin dato` : `evaluables · ${unknown} sin estado del marco`} · {members.length} en el grupo</span>
            </button>)}
          </div>}
          {withoutOrigin > 0 && <p className="muted subgroup-note">{plural(withoutOrigin, "profesor dicta", "profesores dictan")} por primera vez y no {withoutOrigin === 1 ? "tiene" : "tienen"} grupo de partida: no {withoutOrigin === 1 ? "está" : "están"} en estas barras.</p>}
          {CIRCULAR.has(tool.id) && <p className="muted subgroup-note">Los grupos se formaron con la configuración de las herramientas de la plataforma{tool.id === "lockdown" || tool.id === "turnitin" ? `, y ${tool.name} solo existe dentro de cuestionarios o actividades` : `, entre ellas ${tool.name}`}. Por eso esta comparación repite en parte cómo se armaron los grupos.</p>}
          <p className="muted subgroup-note">Los grupos describen patrones de uso. No representan una escala de calidad ni niveles de competencia.</p>
        </div>
      </section>

      <section className="panel" aria-label="Detalle del grupo seleccionado">
        {selectedGroup ? <>
          <SectionHeading eyebrow="Dentro del grupo · grupo nominal, no es un nivel" title={selectedGroup.name} description={selectedGroup.description}/>
          <div className="panel-body">
            <p className="muted">{plural(selectedRecords.length, "profesor", "profesores")} de este grupo de partida en el contexto elegido · {tool.name}</p>
            {!configOnly && <StateBars records={selectedRecords} onSelect={openMembers} compact/>}
            <SectionHeading title={`Personas ${target}`} description="Abre una ficha para revisar la evidencia por herramienta."/>
            {selectedMembers.length ? <>
              <div className="group-member-list">
                {selectedMembers.slice(0, 5).map(record => <PersonButton key={record.professor.id} record={record} onProfessor={onProfessor}/>)}
              </div>
              {/* Profesores has no «configured» filter, so configuration-only tools open the whole group. */}
              <button className="button button-secondary" onClick={() => openMembers()}>{configOnly ? `Ver ${plural(selectedRecords.length, "profesor", "profesores")} del grupo` : selectedMembers.length === 1 ? "Ver 1 profesor" : `Ver los ${selectedMembers.length} profesores`}<Icon name="arrow"/></button>
            </> : <EmptyState title={`Sin profesores ${target}`} description={configOnly ? "Nadie de este grupo la tiene configurada en el contexto elegido." : "Puedes explorar otro estado en las barras de este grupo."}/>}
          </div>
        </> : <EmptyState title="Elige un grupo para conocerlo" description="Verás sus estados de adopción y los profesores de la herramienta seleccionada."/>}
      </section>
    </div>
  </>;
}

function brier(rows: ValidationRow[]) {
  return rows.length ? rows.reduce((sum, row) => sum + (row.probability - Number(row.outcome)) ** 2, 0) / rows.length : null;
}

export function PredictionsPage({ filters, onFilters, onNavigate, onProfessor, onMethod }: PageProps) {
  const [tab, setTab] = useState<"estimates" | "validation">("estimates");
  const availablePeriods = [...new Set(VALIDATION_ROWS.map(row => row.period))].sort();
  const [validationPeriod, setValidationPeriod] = useState<PeriodId | "Todos">(availablePeriods.at(-1) ?? filters.period);
  const [threshold, setThreshold] = useState(50);
  // Local on purpose: a group chosen in Grupos must not stay applied here (problem 14).
  const [groupId, setGroupId] = useState<Filters["group"]>("Todos");
  const tool = TOOLS.find(item => item.id === filters.tool)!;
  const origin = TEXTS.forecastOrigin ?? filters.period;
  // Predicciones uses the group at the forecast origin, not the group of origin of getRecords.
  const records = getRecords({
    period: filters.period,
    faculty: filters.faculty,
    tool: filters.tool,
    state: "Todos",
    search: "",
    probability: "Todas",
  }).filter(record => groupId === "Todos" || record.professor.groupByPeriod[origin] === groupId);
  const eligible = records.filter(record => record.probability !== null);
  const expected = eligible.reduce((sum, record) => sum + (record.probability ?? 0), 0);
  const sortedCandidates = [...eligible].sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
  const habitual = habitualRate(filters.tool);
  const bandRange = (band: ProbabilityBand) => !TEXTS.relativeBands ? TEXTS.bands[band] : habitual === null ? "" : {
    Baja: `Menos de ${formatProbability(habitual)}`,
    Media: `De ${formatProbability(habitual)} a menos de ${formatDoubleRate(filters.tool)}`,
    Alta: `${formatDoubleRate(filters.tool)} o más`,
  }[band];
  const bands = BANDS.map(band => ({
    band,
    label: TEXTS.relativeBands ? TEXTS.bands[band] : band,
    range: bandRange(band),
    count: eligible.filter(record => probabilityBandFor(record.tool.id, record.probability!) === band).length,
  }));
  const maximumBandCount = Math.max(1, ...bands.map(band => band.count));
  const returning = Math.round(RETURN_SHARE * 10);
  const toolValidation = VALIDATION_ROWS.filter(row => row.toolId === filters.tool);
  const rows = toolValidation.filter(row => validationPeriod === "Todos" || row.period === validationPeriod);
  const positives = rows.filter(row => row.outcome).length;
  const predictedPositive = rows.filter(row => row.probability >= threshold / 100);
  const truePositive = predictedPositive.filter(row => row.outcome).length;
  const meanProbability = rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : 0;
  // Five groups with the same number of cases, from the lowest to the highest probability.
  const byProbability = [...rows].sort((a, b) => a.probability - b.probability);
  const calibration = Array.from({ length: 5 }, (_, index) => byProbability.slice(Math.floor(index * rows.length / 5), Math.floor((index + 1) * rows.length / 5)))
    .filter(inBand => inBand.length)
    .map(inBand => ({
      label: `${formatProbability(inBand[0].probability)} – ${formatProbability(inBand.at(-1)!.probability)}`,
      count: inBand.length,
      observed: inBand.filter(row => row.outcome).length,
      probability: inBand.reduce((sum, row) => sum + row.probability, 0) / inBand.length,
    }));
  const rate = (n: number, total: number) => n ? formatProbability(n / total) : "0 %";
  const brierText = (value: number) => value.toLocaleString("es-CO", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const comparisonPeriods = [...new Set(rows.map(row => row.period))].sort();

  // Profesores filters by group of origin, so the group chosen here is not passed on.
  const openCandidates = (probability: Filters["probability"] = "Con estimación") => onNavigate("profesores", {
    period: origin,
    tool: filters.tool,
    probability,
    state: "Todos",
    group: "Todos",
    search: "",
  });

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Predicciones</p><h1 tabIndex={-1}>Qué podría pasar, con qué respaldo.</h1>
        <p className="muted">Consulta oportunidades de configuración y revisa cómo se comporta esta estimación.</p></div>
      <button className="button button-ghost" onClick={onMethod}><Icon name="info"/>Acerca de las estimaciones</button>
    </div>

    <div className="analytics-tabs segmented" aria-label="Secciones de predicciones">
      <button className={tab === "estimates" ? "is-active" : ""} aria-pressed={tab === "estimates"} onClick={() => setTab("estimates")}>Estimaciones</button>
      <button className={tab === "validation" ? "is-active" : ""} aria-pressed={tab === "validation"} onClick={() => setTab("validation")}>Resultados de validación</button>
    </div>

    <div className="toolbar">
      {toolSelect(filters, onFilters)}
      {tab === "validation" ? <label className="field">Periodo de llegada evaluado
        <select value={validationPeriod} onChange={event => setValidationPeriod(event.target.value as PeriodId | "Todos")}>
          {availablePeriods.map(period => <option value={period} key={period}>{formatPeriod(period)}</option>)}
          <option value="Todos">Todos los periodos evaluados</option>
        </select>
      </label> : <>
        <label className="field">Grupo en {formatPeriod(origin)}
          <select value={groupId} onChange={event => setGroupId(event.target.value as Filters["group"])}>
            <option value="Todos">Todos los grupos</option>
            {GROUPS.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
          </select>
        </label>
        <p className="muted subgroup-note">Origen: {formatPeriod(origin)} · {filters.faculty === "Todos" ? "Todas las facultades" : filters.faculty}</p>
      </>}
    </div>

    {tab === "estimates" ? <>
      <div className="callout"><Icon name="info"/><p><strong>Probabilidad de empezar a configurar {tool.name.toLocaleLowerCase("es")}.</strong> Se estima para quienes no la tienen configurada, la próxima vez que dicten. Puede incluir una reactivación. No predice los estados Adopta, Usa o Apropia ni el beneficio de un taller.</p></div>

      {tool.forecast === false ? <section className="panel"><EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no hay pronóstico de empezar a configurar.`}/></section> : offOrigin(filters.period) ? <section className="panel"><OffOrigin period={filters.period} onGo={period => onFilters({ period })}/></section> : <>
      <div className="metrics-grid three-column">
        <Metric label="Profesores con estimación" value={eligible.length} detail={`De ${records.length} profesores en este contexto`} icon="users"/>
        <Metric label="Inicios de configuración esperados" value={decimal(expected)} detail={`Suma de probabilidades para ${tool.name}, si todos vuelven a dictar${RETURN_SHARE < 1 ? `; suelen volver ${returning} de cada 10` : ""}. Es una estimación, no una lista de resultados seguros.`} icon="trend"/>
        <Metric label="Sin estimación en este contexto" value={records.length - eligible.length} detail="Incluye herramientas ya configuradas o información insuficiente." icon="info"/>
      </div>

      {eligible.length ? <div className="two-column">
        <section className="panel">
          <SectionHeading title="Probabilidades, en tres rangos" description="Cada profesor cuenta una vez para esta herramienta. Selecciona un rango para revisar su lista."/>
          <div className="panel-body">
            <div className="probability-histogram" aria-label="Distribución de probabilidades de empezar a configurar">
              {bands.map(band => <button className="histogram-column" key={band.band} onClick={() => openCandidates(band.band)} aria-label={`${band.label}: ${plural(band.count, "profesor", "profesores")}; ${band.range}. Ver lista.`}>
                <strong>{band.count}</strong>
                {band.count > 0 && <span className="histogram-bar" style={{ height: `${band.count / maximumBandCount * 132}px` }} aria-hidden="true"/>}
                <span className="histogram-label"><strong>{band.label}</strong><span>{band.range}</span></span>
              </button>)}
            </div>
            <p className="muted subgroup-note">Los rangos sirven para explorar las estimaciones; no son niveles de adopción ni de calidad docente.{TEXTS.relativeBands && habitual !== null && ` Lo habitual: ${formatProbability(habitual)} empezó a configurar ${tool.name} en la evaluación del modelo.`}{groupId !== "Todos" && " La lista de Profesores no aplica este grupo."}</p>
          </div>
        </section>

        <section className="panel">
          <SectionHeading title="Personas para revisar" description="Primeros casos al ordenar por esta probabilidad. La selección para un taller sigue siendo una decisión de Conecta-TE."
            action={<button className="button button-ghost" onClick={() => openCandidates()}>Ver lista<Icon name="arrow"/></button>}/>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th scope="col">Profesor</th><th scope="col">Estado observado</th><th scope="col">Empezar a configurar</th></tr></thead>
            <tbody>{sortedCandidates.slice(0, 6).map(record => <tr key={record.professor.id}>
              <td><PersonButton record={record} onProfessor={onProfessor}/></td>
              <td><StateBadge state={record.state} label={stateLabel(record)}/></td>
              <td><span className="probability-value">{formatProbability(record.probability!)}</span></td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </div> : <section className="panel"><EmptyState title="Sin oportunidades con estimación" description="En este contexto no hay profesores con la herramienta ausente y evidencia suficiente para este pronóstico. Puedes cambiar la herramienta o los filtros."/></section>}
      </>}
      <p className="muted subgroup-note">{TEXTS.model}</p>
    </> : <>
      <div className="callout"><Icon name="info"/><p><strong>Evaluación global de {tool.name} con {TEXTS.badge.toLocaleLowerCase("es")}.</strong> Incluye todas las facultades y grupos de los periodos evaluados; los filtros de facultad y grupo no se aplican aquí. El objetivo observado es empezar a configurar, no un estado del marco de adopción.{TEXTS.cleanTest && ` Esta evaluación ya se usó para escoger el modelo; la prueba limpia será ${formatPeriod(TEXTS.cleanTest)}.`}</p></div>

      {rows.length ? <>
        <div className="metrics-grid three-column">
          <Metric label="Oportunidades evaluadas" value={rows.length} detail="Cada caso es una oportunidad histórica de configurar esta herramienta." icon="users"/>
          <Metric label="Empezaron a configurar" value={`${positives}/${rows.length}`} detail={`${pct(positives, rows.length)} de los casos evaluados${positives < FEW_STARTS ? " · pocos inicios: cifras frágiles" : ""}`} icon="check"/>
          <Metric label="Probabilidad media estimada" value={`${Math.round(meanProbability * 100)} %`} detail={`Frente a ${pct(positives, rows.length)} observado en estos mismos casos.`} icon="trend"/>
        </div>

        <div className="two-column">
          <section className="panel">
            <SectionHeading title="¿Se parecen lo estimado y lo observado?" description="Los casos se ordenan por probabilidad y se reparten en 5 grupos con el mismo número de casos. Una media global cercana puede ocultar diferencias entre grupos."/>
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th scope="col">Rango estimado</th><th scope="col">Casos</th><th scope="col">Media estimada</th><th scope="col">Inicios observados</th></tr></thead>
              <tbody>{calibration.map((band, index) => <tr key={index}>
                <th scope="row">{band.label}</th>
                <td>{band.count}</td>
                <td><strong>{formatProbability(band.probability)}</strong><span className="bar-track"><span className="bar-fill" style={barStyle(band.probability)}/></span></td>
                <td><strong>{rate(band.observed, band.count)}</strong><span className="bar-track"><span className="bar-fill" data-state="Adopta" style={barStyle(band.observed / band.count)}/></span><span className="muted">{band.observed}/{band.count}</span></td>
              </tr>)}</tbody>
            </table></div>
          </section>

          <section className="panel">
            <SectionHeading title="¿A cuántos identificaríamos?" description="Mueve el punto de corte para ver sus resultados históricos. Este ejercicio no decide quién recibe una invitación."/>
            <div className="panel-body validation-controls">
              <label className="field threshold-control">Señalar un posible inicio a partir de <strong>{threshold} %</strong>
                <input aria-label="Punto de corte para evaluar la predicción" type="range" min="0" max="100" step="5" value={threshold} onChange={event => setThreshold(Number(event.target.value))}/>
              </label>
              <div className="metric">
                <div className="metric-label">De los casos señalados, empezaron a configurar</div>
                <div className="metric-value">{pct(truePositive, predictedPositive.length)}</div>
                <div className="metric-detail">{truePositive}/{predictedPositive.length} casos señalados{predictedPositive.length === 0 ? " · No se señaló ningún caso con este corte." : ""}</div>
              </div>
              <div className="metric">
                <div className="metric-label">De quienes empezaron, habríamos identificado</div>
                <div className="metric-value">{pct(truePositive, positives)}</div>
                <div className="metric-detail">{truePositive}/{positives} inicios observados{positives === 0 ? " · No hubo inicios en estos casos." : ""}</div>
              </div>
            </div>
          </section>
        </div>

        <details className="panel">
          <summary className="panel-header">Comparación con una referencia sencilla y detalle de cálculo</summary>
          <div className="panel-body">
            <p>La referencia asigna a cada caso la tasa de inicio de configuración observada en periodos anteriores de esta misma herramienta. Nunca utiliza el resultado del periodo que intenta anticipar.</p>
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th scope="col">Llegada evaluada</th><th scope="col">Casos</th><th scope="col">Brier del modelo</th><th scope="col">Brier de referencia</th><th scope="col">Error frente a la referencia</th></tr></thead>
              <tbody>{comparisonPeriods.map(period => {
                const current = toolValidation.filter(row => row.period === period);
                const previous = toolValidation.filter(row => row.period < period);
                const historicalRate = previous.length ? previous.filter(row => row.outcome).length / previous.length : null;
                const baseline = historicalRate === null ? null : current.reduce((sum, row) => sum + (historicalRate - Number(row.outcome)) ** 2, 0) / current.length;
                const model = brier(current);
                const reduction = model === null || !baseline ? null : (baseline - model) / baseline;
                return <tr key={period}><th scope="row">{formatPeriod(period)}</th><td>{current.length}</td><td>{model === null ? "—" : brierText(model)}</td><td>{baseline === null ? "Sin periodo anterior disponible" : brierText(baseline)}</td><td>{reduction === null ? "—" : `${decimal(Math.abs(reduction) * 100)} % ${reduction >= 0 ? "menos" : "más"} error`}</td></tr>;
              })}</tbody>
            </table></div>
            <p className="muted">Brier es el promedio de la diferencia al cuadrado entre la probabilidad y el resultado; un valor menor indica menos error en estos casos. Esta comparación evalúa configuración. No demuestra aprendizaje, apropiación ni efecto de los talleres.</p>
            <p className="muted">No hay identificadores, facultad ni grupo en estas filas de validación. Su desempeño no se desglosa por esos segmentos ni se interpreta como personas únicas entre periodos.</p>
          </div>
        </details>
      </> : <section className="panel"><EmptyState title="Sin evaluación para este periodo y herramienta" description="Selecciona otro periodo de llegada. No se trasladan resultados de otras herramientas a esta selección."/></section>}
    </>}
  </>;
}
