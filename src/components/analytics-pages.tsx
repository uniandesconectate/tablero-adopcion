"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { GROUPS, RETURN_SHARE, TEXTS, TOOLS, VALIDATION_ROWS } from "@/lib/data";
import { byCode, byProbability, facultyLong, formatPeriod, formatProbability, getRecords, habitualRate, plainLabel, probabilityBandFor, share, shown } from "@/lib/domain";
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
import { EmptyState, Icon, MODEL_TERMS, Metric, OffOrigin, PersonIcon, SINCE, STATE_SHORT, SectionHeading, StateBadge, StateBars, TARGET, bandRange, bandText, nextTerm, number, offOrigin, pct, plural, trackSentence } from "@/components/ui";

// Groups were built from the configuration of these tools (LockDown and Turnitin live inside quizzes and activities).
const CIRCULAR = new Set(["contenidos", "actividades", "anuncios", "calificaciones", "cuestionarios", "rubricas", "debates", "lockdown", "turnitin"]);
// Below this many observed starts, validation figures are fragile (decision #17).
const FEW_STARTS = 30;

const barStyle = (value: number): CSSProperties => ({ "--bar-width": `${Math.min(100, Math.max(0, value * 100))}%` } as CSSProperties);
const facultyText = (faculty: string) => faculty === "Todos" ? "Todas las facultades" : facultyLong(faculty);

function PersonButton({ record, onProfessor }: { record: TeacherToolRecord; onProfessor: PageProps["onProfessor"] }) {
  return <button className="person-cell inline-link" onClick={() => onProfessor(record)}>
    <PersonIcon/>
    <span><strong>{record.professor.name}</strong><span className="muted">{facultyLong(record.faculty)}</span></span>
  </button>;
}

export function GroupsPage({ filters, onFilters, onNavigate, onProfessor, onMethod }: PageProps) {
  const activeState = STATES.find(state => state === filters.state) ?? "Adopta";
  const tool = TOOLS.find(item => item.id === filters.tool)!;
  const period = formatPeriod(filters.period);
  const records = getRecords({ period: filters.period, faculty: filters.faculty, tool: filters.tool });
  // Keep the state shown here in the filters, so a hidden «Sin información» does not reach Elegir profesores.
  useEffect(() => { if (filters.state !== activeState) onFilters({ state: activeState }); }, [filters.state, activeState, onFilters]);
  const configOnly = tool.evidence === "configuracion";
  // Configuration-only tools compare «configured» over teachers with a known value; the rest compare a state over classified teachers.
  const counted = (record: TeacherToolRecord) => configOnly ? record.observation.configured === true : record.state === activeState;
  const inBase = (record: TeacherToolRecord) => configOnly ? record.observation.configured !== null : record.state !== "Sin información";
  const inGroup = (id: string) => records.filter(record => record.originGroup === id);
  const withoutOrigin = records.filter(record => record.originGroup === null).length;
  const groupData = GROUPS.map(group => {
    const members = inGroup(group.id);
    const base = members.filter(inBase).length;
    const count = members.filter(counted).length;
    return { group, members, base, count, unknown: members.length - base, part: share(count, base) };
  });
  const chosen = GROUPS.find(group => group.id === filters.group);
  // Until one is chosen, the detail shows the group with the highest share; it is not written to the filters.
  const selectedGroup = chosen ?? [...groupData].filter(row => row.part.ratio !== null).sort((a, b) => b.part.ratio! - a.part.ratio!)[0]?.group;
  const selectedRecords = selectedGroup ? inGroup(selectedGroup.id) : [];
  const selectedMembers = selectedRecords.filter(counted).sort(byCode);
  const openMembers = (state: AdoptionState = activeState) => {
    if (selectedGroup) onNavigate("profesores", {
      group: selectedGroup.id,
      state: configOnly ? "Todos" : state,
      configured: configOnly ? "si" : "Todos",
      tool: filters.tool,
      search: "",
      probability: "Todas",
    });
  };
  const target = configOnly ? `con ${tool.name} configurada` : `en ${activeState}`;
  // How stable the groups are: who keeps the group of the previous taught semester in this one.
  const withBoth = records.filter(record => record.originGroup !== null && record.professor.groupByPeriod[record.period]);
  const kept = withBoth.filter(record => record.professor.groupByPeriod[record.period] === record.originGroup).length;
  const detail = useRef<HTMLElement>(null);
  // On a phone the detail sits far below the cards: a tap brings it into view and moves the focus there.
  const choose = (id: string) => {
    onFilters({ group: id });
    setTimeout(() => {
      const box = detail.current?.getBoundingClientRect();
      if (box && (box.top > window.innerHeight * .6 || box.bottom < 0)) { detail.current!.scrollIntoView({ block: "start" }); detail.current!.focus({ preventScroll: true }); }
    }, 0);
  };

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">04 / GRUPOS PARECIDOS</p><h1 tabIndex={-1}>Otra forma de buscar para el taller de {tool.name}: por grupos parecidos</h1><p className="page-tagline">Distintas formas de usar la plataforma.</p>
        <p className="muted"><strong>Opcional: compara grupos de profesores que configuran parecido.</strong> Sirve para ver en qué tipo de profesor hay más personas {configOnly ? `con ${tool.name} configurada` : `en un estado de ${tool.name} (por ejemplo, en Adopta)`} y abrir esa lista. Compara el mismo estado de una herramienta entre grupos y revisa a sus integrantes. Cada profesor cuenta en el grupo que tenía en su semestre anterior: el último que dictó antes de {period}.</p></div>
      <button className="button button-ghost" onClick={() => onMethod("grupos")}><Icon name="info"/>Guía: los grupos</button>
    </div>

    <div className="toolbar">
      {!configOnly && <label className="field">Estado que quieres comparar
        <select value={activeState} onChange={event => onFilters({ state: event.target.value as AdoptionState })}>
          {STATES.map(state => <option value={state} key={state}>{state} · {STATE_SHORT[state]}</option>)}
        </select>
      </label>}
      <p className="muted subgroup-note">{period} · {facultyText(filters.faculty)} · grupo en su semestre anterior</p>
    </div>

    <div className="two-column">
      <section className="panel" aria-label="Comparación de grupos">
        <SectionHeading eyebrow={tool.name} title={configOnly ? `${tool.name} configurada en al menos un aula, por grupo` : `Profesores en ${activeState}, por grupo`}
          description={configOnly
            ? "Configuración, no uso con estudiantes: quienes la tienen configurada entre quienes dictaron y tienen dato de configuración, dentro de cada grupo (el de su semestre anterior)."
            : `Porcentaje entre quienes tienen uno de los 5 estados en ${tool.name}, dentro de cada grupo. Todos los grupos usan la misma escala de 0 a 100 %.`}/>
        <div className="panel-body">
          {records.length === 0 ? <EmptyState title="Sin profesores en este contexto" description="Prueba con otra facultad o herramienta."/> : <div className="bar-list">
            {groupData.map(({ group, members, base, count, unknown, part }) => <button
              className={`group-card ${selectedGroup?.id === group.id ? "is-selected" : ""}`}
              key={group.id}
              aria-pressed={selectedGroup?.id === group.id}
              onClick={() => choose(group.id)}
              aria-label={configOnly
                ? `${group.name}: ${number(count)} de ${number(base)} profesores con dato la tienen configurada; ${number(unknown)} sin dato. Ver grupo.`
                : `${group.name}: ${number(count)} de ${number(base)} profesores clasificados en ${activeState}; ${number(unknown)} sin estado. Ver grupo.`}
            >
              <span className="group-card-heading"><strong>{group.name}</strong><strong>{part.text}</strong></span>
              {part.ratio !== null && <span className="bar-track"><span className="bar-fill" style={barStyle(part.ratio)}/></span>}
              <span className="muted">{configOnly ? `${number(count)} de ${number(base)} con dato la tienen configurada · ${number(unknown)} sin dato` : `${number(count)} de ${number(base)} clasificados están en ${activeState} · ${number(unknown)} sin estado`} · {number(members.length)} en el grupo</span>
            </button>)}
          </div>}
          <p className="muted subgroup-note">Los grupos describen qué combinación de herramientas configura cada profesor. No son una escala de calidad ni niveles de competencia: {GROUPS[0]?.id} a {GROUPS.at(-1)?.id} son nombres, no un orden. En sus textos, «K5» es el método que armó los 5 grupos y «grupo nominal» quiere decir que el grupo es un nombre, no un nivel.</p>
          {withoutOrigin > 0 && <p className="muted subgroup-note">{plural(withoutOrigin, "profesor no tiene", "profesores no tienen")} un semestre anterior registrado desde {SINCE} (por ejemplo, porque {withoutOrigin === 1 ? "dicta" : "dictan"} por primera vez), así que no {withoutOrigin === 1 ? "tiene" : "tienen"} grupo y no {withoutOrigin === 1 ? "aparece" : "aparecen"} en estas barras.</p>}
          {withBoth.length > 0 && <p className="muted subgroup-note">Qué tan estables son: de {plural(withBoth.length, "profesor", "profesores")} con grupo en su semestre anterior y en {period}, {number(kept)} ({pct(kept, withBoth.length)}) siguen en el mismo grupo; los demás cambiaron de grupo de un semestre al siguiente.</p>}
          {(CIRCULAR.has(tool.id) || (!configOnly && activeState === "Adopta")) && <details className="muted subgroup-note"><summary>Cómo leer estos grupos</summary>
          {CIRCULAR.has(tool.id) && <p className="muted subgroup-note">Ojo al comparar: los grupos se armaron mirando qué herramientas configura cada profesor, {tool.id === "lockdown" || tool.id === "turnitin" ? `entre ellas cuestionarios y actividades, y ${tool.name} solo existe dentro de cuestionarios o actividades` : `entre ellas ${tool.name}`}. Por eso, parte de las diferencias entre grupos viene de cómo se armaron y no es un hallazgo nuevo.</p>}
          {!configOnly && activeState === "Adopta" && <p className="muted subgroup-note">Un porcentaje bajo en Adopta puede querer decir que en ese grupo muchos ya la usaban: mira también Usa y Apropia en el detalle del grupo.</p>}
          </details>}
        </div>
      </section>

      <section ref={detail} tabIndex={-1} className="panel" aria-label="Detalle del grupo seleccionado">
        {selectedGroup ? <>
          <SectionHeading eyebrow="Dentro del grupo · describe, no califica" title={selectedGroup.name} description={selectedGroup.description}/>
          <div className="panel-body">
            {!chosen && <p className="small">Se muestra el grupo con el porcentaje más alto. Toca otro grupo para verlo.</p>}
            <p className="muted">{plural(selectedRecords.length, "profesor", "profesores")} de este grupo · {tool.name} · {period} · {facultyText(filters.faculty)}</p>
            {!configOnly && <StateBars records={selectedRecords} onSelect={openMembers} compact/>}
            <SectionHeading title={`Personas ${target}`} description="Los 5 primeros por código, no es un orden de prioridad. Abre una ficha para ver su historia en cada herramienta."/>
            {selectedMembers.length ? <>
              <div className="group-member-list">
                {selectedMembers.slice(0, 5).map(record => <PersonButton key={record.professor.id} record={record} onProfessor={onProfessor}/>)}
              </div>
              <button className="button button-secondary" onClick={() => openMembers()}>{selectedMembers.length === 1 ? "Ver a esta persona" : `Ver a los ${number(selectedMembers.length)} y elegir`}<Icon name="arrow"/></button>
            </> : <EmptyState title={`Sin profesores ${target}`} description={configOnly ? "Nadie de este grupo la tiene configurada en el contexto elegido." : "Puedes explorar otro estado en las barras de este grupo."}/>}
          </div>
        </> : <EmptyState title="Elige un grupo para conocerlo" description={`Verás los estados de sus profesores en ${tool.name} y quiénes ${configOnly ? "la tienen configurada" : "son"}.`}/>}
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
  // The review starts at the cut the rest of the dashboard calls «probabilidad alta» (twice the habitual rate), in percent.
  const habitualShown = habitualRate(filters.tool);
  const highCut = habitualShown === null ? 50 : Math.round(2 * shown(habitualShown) * 1000) / 10;
  const [threshold, setThreshold] = useState(highCut);
  useEffect(() => setThreshold(highCut), [highCut]);
  // Local on purpose: a group chosen in Grupos must not stay applied here (problem 14).
  const [groupId, setGroupId] = useState<Filters["group"]>("Todos");
  const tool = TOOLS.find(item => item.id === filters.tool)!;
  const origin = TEXTS.forecastOrigin ?? filters.period;
  const period = formatPeriod(filters.period);
  const wholeUniversity = filters.faculty === "Todos" ? "" : " (en toda la universidad)";
  // Pronóstico uses the group at the forecast origin, not the group of origin of getRecords.
  const records = getRecords({ period: filters.period, faculty: filters.faculty, tool: filters.tool })
    .filter(record => groupId === "Todos" || record.professor.groupByPeriod[origin] === groupId);
  const eligible = records.filter(record => record.probability !== null);
  const expected = eligible.reduce((sum, record) => sum + (record.probability ?? 0), 0);
  const sortedCandidates = [...eligible].sort(byProbability);
  const missing = records.filter(record => record.probability === null);
  const missingParts = [
    [missing.filter(r => r.observation.configured === true).length, "ya la tiene configurada", "ya la tienen configurada"],
    [missing.filter(r => r.observation.configured === null).length, "sin dato de configuración", "sin dato de configuración"],
    [missing.filter(r => r.observation.configured === false).length, "sin pronóstico", "sin pronóstico"],
  ] as const;
  const habitual = habitualRate(filters.tool);
  const bands = [...BANDS].reverse().map((band: ProbabilityBand) => ({
    band,
    label: TEXTS.relativeBands ? TEXTS.bands[band] : band,
    range: TEXTS.relativeBands ? bandRange(filters.tool, band) : TEXTS.bands[band],
    count: eligible.filter(record => probabilityBandFor(record.tool.id, record.probability!) === band).length,
  }));
  const maximumBandCount = Math.max(1, ...bands.map(band => band.count));
  const returning = Math.round(RETURN_SHARE * 10);
  const toolValidation = VALIDATION_ROWS.filter(row => row.toolId === filters.tool);
  const rows = toolValidation.filter(row => validationPeriod === "Todos" || row.period === validationPeriod);
  const positives = rows.filter(row => row.outcome).length;
  const allPositives = toolValidation.filter(row => row.outcome).length;
  // Shown probabilities, in tenths of a percent, as the bands compare them.
  const predictedPositive = rows.filter(row => Math.round(shown(row.probability) * 1000) >= Math.round(threshold * 10));
  const truePositive = predictedPositive.filter(row => row.outcome).length;
  // The same cut on the exact probability, kept as a second-level detail.
  const exactPositive = rows.filter(row => row.probability >= threshold / 100);
  const meanProbability = rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : 0;
  // Five groups with the same number of cases, from the lowest to the highest probability.
  const ascending = [...rows].sort((a, b) => a.probability - b.probability);
  const calibration = Array.from({ length: 5 }, (_, index) => ascending.slice(Math.floor(index * rows.length / 5), Math.floor((index + 1) * rows.length / 5)))
    .filter(inBand => inBand.length)
    .map(inBand => ({
      label: `${formatProbability(inBand[0].probability)} – ${formatProbability(inBand.at(-1)!.probability)}`,
      count: inBand.length,
      observed: inBand.filter(row => row.outcome).length,
      probability: inBand.reduce((sum, row) => sum + row.probability, 0) / inBand.length,
    }));
  const rate = (n: number, total: number) => n ? formatProbability(n / total) : "0\u00a0%";
  const per100 = (band: { observed: number; count: number }) => number(Math.round(band.observed / band.count * 100));
  const brierText = (value: number) => value.toLocaleString("es-CO", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  const comparisonPeriods = [...new Set(rows.map(row => row.period))].sort();
  const validationLabel = (value: PeriodId | "Todos") => value === "Todos" ? `Ambos (${availablePeriods.map(formatPeriod).join(" y ")})` : formatPeriod(value);
  const arrival = validationPeriod === "Todos" ? availablePeriods.map(formatPeriod).join(" o a ") : formatPeriod(validationPeriod);
  const thresholdText = `${threshold.toLocaleString("es-CO", { maximumFractionDigits: 1 })}\u00a0%`;
  // The simple rule gives each case the share that configured it in the reviewed semesters before; the first one has none.
  const comparison = comparisonPeriods.map(value => {
    const current = toolValidation.filter(row => row.period === value);
    const previous = toolValidation.filter(row => row.period < value);
    const historicalRate = previous.length ? previous.filter(row => row.outcome).length / previous.length : null;
    const baseline = historicalRate === null ? null : current.reduce((sum, row) => sum + (historicalRate - Number(row.outcome)) ** 2, 0) / current.length;
    const model = brier(current);
    return { period: value, cases: current.length, model, baseline, reduction: model === null || !baseline ? null : (baseline - model) / baseline };
  });
  // shortcut: the word cuts (2 % and 15 % less error) are a reading aid, not a statistical test; revisit them with Conecta-TE.
  const inWords = (reduction: number) => reduction < 0 ? "peor que la regla simple" : reduction < 0.02 ? "casi igual que la regla simple" : reduction < 0.15 ? "algo mejor que la regla simple" : "mejor que la regla simple";
  const lastComparison = comparison.filter(row => row.reduction !== null).at(-1);
  const top100 = calibration.length > 1 ? Math.round(calibration.at(-1)!.observed / calibration.at(-1)!.count * 100) : null;
  const overall100 = rows.length ? Math.round(positives / rows.length * 100) : 0;
  const separates = top100 !== null && top100 > overall100;
  const verdict = top100 === null ? "" : `En ${tool.name}, entre los casos que el pronóstico puso más arriba (la quinta parte con probabilidad más alta), la configuraron ${number(top100)} de cada 100, frente a ${number(overall100)} de cada 100 en todos los casos revisados de ${validationLabel(validationPeriod)}${separates && overall100 ? ` (unas ${number(Math.round(top100 / overall100 * 10) / 10)} veces más)` : ""}.${lastComparison ? ` Frente a una regla simple que repite lo que pasó antes, en ${formatPeriod(lastComparison.period)} ${lastComparison.reduction! < 0 ? "se equivocó más" : `acertó ${inWords(lastComparison.reduction!).replace(" que la regla simple", "")}`} (detalle abajo, en «¿Acierta más que una regla simple?»).` : ""}${!separates || (lastComparison && lastComparison.reduction! < 0) ? " Aquí no acierta mejor que lo simple: úsalo solo para explorar." : " Sirve para ordenar a quién mirar primero, no para saber quién la configurará."}`;
  // Whether the forecast fell short or went over in the review, for reading «unos N».
  const allMean = toolValidation.length ? toolValidation.reduce((sum, row) => sum + row.probability, 0) / toolValidation.length : 0;
  const allRate = toolValidation.length ? allPositives / toolValidation.length : 0;
  const bias = !toolValidation.length || Math.abs(allMean - allRate) < 0.01 ? "" : allMean < allRate ? `En la revisión se quedó corto: dio en promedio ${pct(allMean * 1000, 1000)} y la configuró el ${pct(allPositives, toolValidation.length)}, así que la cifra real podría ser algo mayor.` : `En la revisión se pasó: dio en promedio ${pct(allMean * 1000, 1000)} y la configuró el ${pct(allPositives, toolValidation.length)}, así que la cifra real podría ser algo menor.`;
  const groupNote = `En «Elegir profesores» y «Grupos parecidos» se usa el grupo de su semestre anterior; aquí, el de ${formatPeriod(origin)}, porque el pronóstico parte de lo que configuró ese semestre.`;

  // Elegir profesores filters by group of origin, so the group chosen here is not passed on.
  const openCandidates = (probability: Filters["probability"] = "Con estimación") => onNavigate("profesores", {
    period: origin,
    tool: filters.tool,
    probability,
    state: "Todos",
    group: "Todos",
    search: "",
    configured: "Todos",
  });

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">05 / PRONÓSTICO</p><h1 tabIndex={-1}>¿Quién podría configurar {tool.name} {nextTerm}?</h1><p className="page-tagline">Qué podría pasar, con qué respaldo.</p>
        <p className="muted">Consulta quién podría empezar a configurar {tool.name} y revisa qué tan bien acertó este cálculo antes.</p></div>
      <button className="button button-ghost" onClick={() => onMethod("pronostico")}><Icon name="info"/>Guía: el pronóstico</button>
    </div>

    <div className="analytics-tabs segmented" aria-label="Secciones del pronóstico">
      <button className={tab === "estimates" ? "is-active" : ""} aria-pressed={tab === "estimates"} onClick={() => setTab("estimates")}>Quién podría empezar</button>
      <button className={tab === "validation" ? "is-active" : ""} aria-pressed={tab === "validation"} onClick={() => setTab("validation")}>¿Qué tan bien acierta?</button>
    </div>

    <div className="toolbar">
      {tab === "validation" ? <label className="field">Semestre revisado
        <select value={validationPeriod} onChange={event => setValidationPeriod(event.target.value as PeriodId | "Todos")}>
          {availablePeriods.map(value => <option value={value} key={value}>{validationLabel(value)}</option>)}
          <option value="Todos">{validationLabel("Todos")}</option>
        </select>
      </label> : tool.forecast === false || offOrigin(filters.period) ? null : <>
        <label className="field" title={groupNote}>Grupo en {formatPeriod(origin)} (semestre del que parte el pronóstico)
          <select value={groupId} onChange={event => setGroupId(event.target.value as Filters["group"])}>
            <option value="Todos">Todos los grupos</option>
            {GROUPS.map(group => <option value={group.id} key={group.id}>{group.name}</option>)}
          </select>
        </label>
        <p className="muted subgroup-note">Calculado con datos de {formatPeriod(origin)} · {facultyText(filters.faculty)}. {groupNote}</p>
      </>}
    </div>

    {tab === "estimates" ? tool.forecast === false ? <section className="panel"><EmptyState title="Sin modelo para esta herramienta" description={`Para ${tool.name} no hay pronóstico de empezar a configurar.`}/></section> : offOrigin(filters.period) ? <section className="panel"><OffOrigin period={filters.period} onGo={period => onFilters({ period })}/></section> : <>
      <div className="callout"><Icon name="info"/><p><strong>Probabilidad de que configure {tool.name} la próxima vez que dicte{TARGET ? ` (${formatPeriod(TARGET)})` : ""}, calculada con los datos de {formatPeriod(origin)}.</strong> Solo para quienes no la tenían configurada en {formatPeriod(origin)}; incluye a quienes la tuvieron antes y la dejaron. No predice los estados Adopta, Usa o Apropia ni el beneficio de un taller.</p></div>
      <details className="subgroup-note technical"><summary>Cómo se calculó y por qué la revisión es justa</summary><p>{TEXTS.modelPlain}{availablePeriods.length > 0 && ` La confianza que se muestra viene de revisarlo contra ${availablePeriods.map(formatPeriod).join(" y ")} (pestaña «¿Qué tan bien acierta?»).`}</p>{TEXTS.review && <p>{TEXTS.review}</p>}<details><summary>Ver detalle técnico</summary><p>{MODEL_TERMS}</p><p>{TEXTS.model}</p></details></details>

      <div className="metrics-grid three-column">
        <Metric label="Con probabilidad calculada" value={number(eligible.length)} detail={`de los ${plural(records.length, "profesor", "profesores")} que dictaron en ${period}${records.length ? ` (${pct(eligible.length, records.length)})` : ""}`} icon="users"/>
        <Metric label="Cuántos podrían configurarla" value={`unos ${number(Math.round(expected))}`} detail={<>Si todos volvieran a dictar, se espera que unos {number(Math.round(expected))} la configuren. Sale de sumar las probabilidades de cada persona (da {number(expected)}): es una estimación, no una lista de personas que seguro empezarán.{RETURN_SHARE < 1 && ` Suelen volver a dictar ${returning} de cada 10 profesores${wholeUniversity}; no todos vuelven el semestre siguiente: con esa parte, serían unos ${number(Math.round(expected * RETURN_SHARE))}.`}{bias && ` ${bias}`}</>} icon="trend"/>
        <Metric label="Sin probabilidad calculada" value={number(missing.length)} detail={`No quiere decir 0\u00a0%.${missing.length ? ` ${missingParts.filter(([n]) => n > 0).map(([n, one, many]) => `${number(n)} ${n === 1 ? one : many}`).join(" · ")}.` : ""} Con y sin probabilidad suman los ${number(records.length)} que dictaron (${number(eligible.length)} + ${number(missing.length)}).`} icon="info"/>
      </div>

      {eligible.length ? <div className="two-column forecast-columns">
        <section className="panel">
          <SectionHeading title="Probabilidades, en tres rangos" description="Cada profesor cuenta una vez. Toca un rango para ver su lista, ordenada por probabilidad."/>
          <div className="panel-body">
            <div className="probability-histogram" aria-label="Distribución de probabilidades de configurar">
              {bands.map(band => <button className="histogram-column" key={band.band} onClick={() => openCandidates(band.band)} aria-label={`${band.label}: ${plural(band.count, "profesor", "profesores")}; ${band.range}. Ver lista.`}>
                <strong>{number(band.count)}</strong>
                {band.count > 0 && <span className="histogram-bar" style={{ height: `${band.count / maximumBandCount * 132}px` }} aria-hidden="true"/>}
                <span className="histogram-label"><strong>{band.label}</strong><span>{band.range}</span></span>
              </button>)}
            </div>
            <p className="muted subgroup-note">{TEXTS.relativeBands && habitual !== null && `Lo habitual en ${tool.name}: ${formatProbability(habitual)} (${number(allPositives)} de ${number(toolValidation.length)} veces en que no la tenían configurada, al llegar a ${availablePeriods.map(formatPeriod).join(" o ")}). `}{trackSentence(tool.id, "Alta") && `${trackSentence(tool.id, "Alta")} `}Los rangos sirven para explorar; no son niveles de adopción ni de calidad docente.{groupId !== "Todos" && " Ojo: la lista que se abre no filtra por el grupo elegido aquí, porque allá se usa el grupo del semestre anterior."}</p>
          </div>
        </section>

        <section className="panel">
          <SectionHeading title={`Los ${Math.min(6, sortedCandidates.length)} con mayor probabilidad`} description={`De ${number(eligible.length)} con probabilidad calculada, en cualquier estado (${[...new Set(eligible.map(record => tool.evidence === "configuracion" ? "Configurada: no" : plainLabel(record)))].map(label => `${number(eligible.filter(record => (tool.evidence === "configuracion" ? "Configurada: no" : plainLabel(record)) === label).length)} en ${label}`).join(", ")}); la lista de «Armar la lista de este taller» abre solo a ${tool.evidence === "configuracion" ? "quienes no la tienen configurada" : "No expuesto"}. No es una lista de invitados: la selección para un taller sigue siendo una decisión de Conecta-TE.`}
            action={<button className="button button-ghost" onClick={() => openCandidates()}>Ver a los {number(eligible.length)} en orden<Icon name="arrow"/></button>}/>
          <div className="table-wrap"><table className="data-table as-cards">
            <thead><tr><th scope="col">Profesor</th><th scope="col">Probabilidad{TARGET ? ` (${formatPeriod(TARGET)})` : ""}</th><th scope="col">Estado en {period}</th><th scope="col">¿La ha tenido antes en sus aulas?</th></tr></thead>
            <tbody>{sortedCandidates.slice(0, 6).map(record => <tr key={record.professor.id}>
              <td data-label="Profesor"><PersonButton record={record} onProfessor={onProfessor}/></td>
              <td data-label={`Probabilidad${TARGET ? ` (${formatPeriod(TARGET)})` : ""}`}><span className="probability-value">{formatProbability(record.probability!)}</span><span className="state-note">{bandText(tool.id, probabilityBandFor(tool.id, record.probability!))}</span></td>
              <td data-label={`Estado en ${period}`}><StateBadge state={record.state} label={tool.evidence === "configuracion" ? "Configurada: no" : plainLabel(record)}/></td>
              <td className="table-reason" data-label="¿La ha tenido antes en sus aulas?">{record.forecastReason ?? "—"}</td>
            </tr>)}</tbody>
          </table></div>
        </section>
      </div> : <section className="panel"><EmptyState title="Nadie con probabilidad calculada" description={`En este contexto no hay profesores sin ${tool.name} configurada y con datos suficientes para el pronóstico. Prueba otra herramienta o facultad.`}/></section>}
    </> : <>
      {filters.faculty !== "Todos" && <p className="faculty-warning"><strong>Estas cifras son de toda la universidad, no de {facultyLong(filters.faculty)}.</strong></p>}
      <div className="callout"><Icon name="info"/><p><strong>Revisión de {tool.name} con {TEXTS.badge.toLocaleLowerCase("es")} de todas las facultades y grupos.</strong> Aquí no se aplican los filtros de facultad ni de grupo. Se mide si la configuraron, no su estado.{TEXTS.cleanTest && ` Esta revisión ya se usó para elegir el pronóstico, así que puede verse algo mejor de lo que es; la prueba definitiva será con ${formatPeriod(TEXTS.cleanTest)}.`}</p></div>

      {rows.length ? <>
        {verdict && <p className="validation-verdict"><strong>En pocas palabras:</strong> {verdict}</p>}
        {calibration.length > 1 && <p className="validation-summary">De cada 100 casos con la probabilidad más alta (la quinta parte de arriba), {per100(calibration.at(-1)!)} la configuraron; de cada 100 con la más baja (la quinta parte de abajo), {per100(calibration[0])}. En todos estos casos, {number(overall100)} de cada 100.</p>}
        <div className="metrics-grid three-column">
          <Metric label="Casos revisados" value={number(rows.length)} detail={`Cada caso es un profesor que no tenía ${tool.name} configurada en un semestre; se mira si la configuró al llegar a ${arrival}.${validationPeriod === "Todos" && availablePeriods.length > 1 ? " Una misma persona puede contar en los dos semestres revisados." : ""}`} icon="users"/>
          <Metric label="La configuraron" value={`${number(positives)} de ${number(rows.length)}`} detail={`${pct(positives, rows.length)} de los casos revisados${positives < FEW_STARTS ? " · pocos inicios: cifras frágiles" : ""}${validationPeriod !== "Todos" && availablePeriods.length > 1 ? `. Contando ${availablePeriods.map(formatPeriod).join(" y ")} juntos fue ${pct(allPositives, toolValidation.length)} (${number(allPositives)} de ${number(toolValidation.length)}): ese es «lo habitual».` : ""}`} icon="check"/>
          <Metric label="Probabilidad promedio que dio el pronóstico" value={`${Math.round(meanProbability * 100)}\u00a0%`} detail={`Frente a ${pct(positives, rows.length)} que la configuró en estos mismos casos.`} icon="trend"/>
        </div>

        <div className="two-column">
          <section className="panel">
            <SectionHeading title="¿Acierta en cada nivel de probabilidad?" description="Ordenamos los casos de menor a mayor probabilidad y los partimos en 5 partes con el mismo número de casos. En cada parte se compara lo que esperaba el pronóstico con lo que pasó. Que acierte en el total no garantiza que acierte en cada parte."/>
            <div className="table-wrap"><table className="data-table as-cards">
              <thead><tr><th scope="col">Probabilidad que dio (rango)</th><th scope="col">Casos</th><th scope="col">Esperado (promedio)</th><th scope="col">La configuraron</th></tr></thead>
              <tbody>{calibration.map((band, index) => <tr key={index}>
                <th scope="row" data-label="Probabilidad que dio (rango)">{band.label}</th>
                <td data-label="Casos">{number(band.count)}</td>
                <td data-label="Esperado (promedio)"><strong>{formatProbability(band.probability)}</strong><span className="bar-track"><span className="bar-fill" style={barStyle(band.probability)}/></span></td>
                <td data-label="La configuraron"><strong>{rate(band.observed, band.count)}</strong><span className="bar-track"><span className="bar-fill" data-state="Adopta" style={barStyle(band.observed / band.count)}/></span><span className="muted">{number(band.observed)} de {number(band.count)}</span></td>
              </tr>)}</tbody>
            </table></div>
          </section>

          <section className="panel">
            <SectionHeading title="¿A cuántos identificaríamos?" description={`Empieza en el corte que el resto del tablero llama «probabilidad alta» en ${tool.name} (${formatProbability(highCut / 100)}): así estas cifras hablan de la misma lista. Mueve el corte para ver qué habría pasado antes. Este ejercicio no decide quién recibe una invitación.`}/>
            <div className="panel-body validation-controls">
              <label className="field threshold-control">Si solo señaláramos a quienes tienen <strong>{thresholdText} o más</strong>{threshold === highCut && <> <span>(el corte de «probabilidad alta»)</span></>}
                <input aria-label="Corte de probabilidad para esta revisión" aria-valuetext={`${thresholdText} o más`} type="range" min="0" max="100" step="0.1" value={threshold} onChange={event => setThreshold(Number(event.target.value))}/>
              </label>
              {threshold !== highCut && <button className="text-link" onClick={() => setThreshold(highCut)}>Volver al corte de «probabilidad alta» ({formatProbability(highCut / 100)})</button>}
              <div className="metric">
                <div className="metric-label">De los señalados, la configuraron</div>
                <div className="metric-value">{pct(truePositive, predictedPositive.length)}</div>
                <div className="metric-detail">{number(truePositive)} de {plural(predictedPositive.length, "caso señalado", "casos señalados")}{predictedPositive.length === 0 ? " · No se señaló ningún caso con este corte." : ""}</div>
              </div>
              <div className="metric">
                <div className="metric-label">De quienes la configuraron, habríamos señalado a</div>
                <div className="metric-value">{pct(truePositive, positives)}</div>
                <div className="metric-detail">{number(truePositive)} de {number(positives)}{positives === 0 ? " · No hubo inicios en estos casos." : ""}</div>
              </div>
              <p className="small muted">Con un corte de {thresholdText} se señalan {number(predictedPositive.length)} de {number(rows.length)} casos y {number(truePositive)} de ellos la configuraron. De los {number(positives)} que la configuraron, se habría llegado a {number(truePositive)}. Con un corte más bajo se llega a más personas, con más casos que no la configuraron.</p>
              <details className="context-help"><summary>¿Y con la probabilidad exacta, sin redondear?</summary><p>Estas cifras comparan la probabilidad tal como se ve en las listas, redondeada (por ejemplo, 49,6&nbsp;% se ve como 50&nbsp;%), para que hablen de los mismos rangos. Con la probabilidad exacta, un corte de {thresholdText} señala {number(exactPositive.length)} de {number(rows.length)} casos y {number(exactPositive.filter(row => row.outcome).length)} de ellos la configuraron.</p></details>
            </div>
          </section>
        </div>

        <details className="panel">
          <summary className="panel-header">¿Acierta más que una regla simple? (comparación y detalle de cálculo)</summary>
          <div className="panel-body">
            <p>La regla simple le da a cada caso la parte de profesores que configuró esta herramienta en semestres anteriores; nunca usa el resultado del semestre que intenta anticipar.</p>
            <div className="table-wrap"><table className="data-table">
              <thead><tr><th scope="col">Semestre revisado</th><th scope="col">Casos</th><th scope="col">Error del pronóstico (Brier)</th><th scope="col">Error de la regla simple (Brier)</th><th scope="col">Diferencia</th></tr></thead>
              <tbody>{comparison.map(({ period: value, cases, model, baseline, reduction }) => <tr key={value}><th scope="row">{formatPeriod(value)}</th><td>{number(cases)}</td><td>{model === null ? "—" : brierText(model)}</td><td>{baseline === null ? `Sin regla simple: la regla usa lo que pasó en los semestres revisados anteriores, y ${formatPeriod(value)} es el primero que trae el archivo` : brierText(baseline)}</td><td>{reduction === null ? "—" : `${number(Math.abs(reduction) * 100)}\u00a0% ${reduction >= 0 ? "menos" : "más"} error que la regla simple: ${inWords(reduction)}`}</td></tr>)}</tbody>
            </table></div>
            <p className="muted">Brier: promedio de (probabilidad − resultado)²; un valor más bajo quiere decir menos error en estos casos. Las palabras («casi igual» con menos de 2&nbsp;% de diferencia, «algo mejor» hasta 15&nbsp;%, «mejor» desde ahí) son solo una guía de lectura, no una prueba estadística. Esta comparación mide configuración: no demuestra aprendizaje, apropiación ni efecto de los talleres.</p>
            <p className="muted">Esta revisión no guarda quién es cada caso ni su facultad o grupo: no se puede separar por facultad o grupo, y una misma persona puede contar en los dos semestres.</p>
          </div>
        </details>
      </> : <section className="panel"><EmptyState title="Sin revisión para este semestre y herramienta" description="Elige otro semestre revisado. No se usan resultados de otras herramientas."/></section>}
    </>}
  </>;
}
