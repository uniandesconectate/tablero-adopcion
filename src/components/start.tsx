"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { setSource } from "@/lib/data";
import { buildRealSource } from "@/lib/real";
import Dashboard from "./dashboard";
import { Icon } from "./ui";

const PREFIX = "Datos reales (tablero.json): ";
const TECHNICAL = " (Para el equipo de datos: ";
/** Plain reason why a file is not a valid tablero.json, and the detail for the data team; `text` tells an empty or cut download from another kind of file. */
function reason(error: unknown, text: string): [string, string] {
  if (error instanceof SyntaxError) return [!text.trim() ? "está vacío." : text.trimStart().startsWith("{") ? "está cortado o dañado: parece que la descarga no terminó." : "su contenido no es el de un tablero.json.", ""];
  if (!(error instanceof Error) || !error.message.startsWith(PREFIX)) return ["no tiene la estructura de tablero.json.", ""];
  const message = error.message.slice(PREFIX.length);
  const cut = message.indexOf(TECHNICAL);
  // Messages without a plain part are only for the data team.
  return cut < 0 ? ["tiene un error por dentro y el tablero no lo puede leer.", message] : [message.slice(0, cut), message.slice(cut + TECHNICAL.length).replace(/\)$/, "")];
}

/** The app opens here: nothing is shown until a valid tablero.json is opened, and the file is kept only in this tab. */
export default function Start() {
  const [open, setOpen] = useState(false);
  // After «Cambiar archivo» the previous file stays loaded, so a mistaken tap can go back.
  const [loaded, setLoaded] = useState("");
  const [reading, setReading] = useState("");
  const [error, setError] = useState<[string, string] | null>(null);
  const [over, setOver] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  // The message lands where the eyes are: focus also scrolls it into view.
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setReading(file.name);
    let text = "";
    try {
      text = await file.text();
      setSource(buildRealSource(JSON.parse(text)));
      setOpen(true); setLoaded(file.name);
    } catch (problem) {
      const [plain, detail] = reason(problem, text);
      setError([`No pudimos abrir «${file.name}»: ${plain}`, detail]);
    }
    setReading("");
  };
  const drop = (event: DragEvent) => { event.preventDefault(); setOver(false); load(event.dataTransfer.files[0]); };
  if (open) return <Dashboard onChangeFile={() => setOpen(false)}/>;
  return <main className="start" onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }} onDrop={drop}>
    <section className="start-panel">
      <div className="brand"><span className="brand-symbol" aria-hidden="true"><span/><span/><span/><span/></span><span className="brand-text">Conecta<span>—</span>TE<small className="brand-subtitle">Universidad de los Andes</small></span></div>
      {loaded && <div className="callout start-open"><Icon name="info"/><div><p>Ya tienes abierto <strong>«{loaded}»</strong>. Elige otro archivo para reemplazarlo, o vuelve al tablero sin cambiar nada.</p><button className="button button-secondary" onClick={() => setOpen(true)}>Volver al tablero con el archivo que ya estaba abierto <Icon name="arrow" size={15}/></button></div></div>}
      <p className="eyebrow">Adopción y acompañamiento</p>
      <h1>Abre el archivo del semestre para empezar.</h1>
      <p className="page-description">El tablero se arma con <strong>tablero.json</strong>, el archivo con el uso de las herramientas de Bloque Neón de cada profesor, semestre a semestre.</p>
      <p className="page-description">Lo prepara cada semestre el equipo de datos de Conecta-TE en Databricks, la plataforma donde se procesan estos datos. Si no lo tienes, pídeselo a ese equipo.</p>
      {error && <div ref={alert} tabIndex={-1} className="callout is-error" role="alert"><Icon name="info"/><div><strong>{error[0]}</strong><p>Qué hacer: revisa que elegiste el tablero.json que te dio el equipo de datos y vuelve a elegirlo. Si el mensaje sigue, pídele a ese equipo un archivo nuevo y envíale este mensaje.</p>{error[1] && <details><summary>Detalle para el equipo de datos</summary><p>{error[1]}</p></details>}</div></div>}
      <div className="drop-zone" data-over={over || undefined}>
        <Icon name="upload" size={26}/>
        <p><strong>Elige el archivo tablero.json</strong><span className="drag-hint">o arrástralo a este recuadro</span></p>
        <label className="button button-primary file-button">Elegir el archivo<input className="sr-only" type="file" accept=".json,application/json" onChange={event => { load(event.target.files?.[0]); event.target.value = ""; }}/></label>
      </div>
      <p className="small muted" role="status">{reading && `Leyendo «${reading}»…`}</p>
      <p className="start-privacy"><Icon name="info" size={17}/><span>El archivo se lee solo en este navegador: no se sube a ningún servidor y no se guarda. Al recargar o cerrar la página, el tablero lo vuelve a pedir. Lo único que este navegador recuerda es la convocatoria que armes (códigos y talleres marcados), hasta que la vacíes.</span></p>
    </section>
  </main>;
}
