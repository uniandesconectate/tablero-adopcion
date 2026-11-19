"use client";

import { useState, type DragEvent } from "react";
import { setSource } from "@/lib/data";
import { buildRealSource } from "@/lib/real";
import Dashboard from "./dashboard";
import { Icon } from "./ui";

const PREFIX = "Datos reales (tablero.json): ";
/** Plain reason why a file is not a valid tablero.json. */
const reason = (error: unknown) => error instanceof SyntaxError ? "no es un archivo JSON, que es el formato de tablero.json."
  : error instanceof Error && error.message.startsWith(PREFIX) ? error.message.slice(PREFIX.length)
  : "no tiene la estructura de tablero.json.";

/** The app opens here: nothing is shown until a valid tablero.json is opened, and the file is kept only in this tab. */
export default function Start() {
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(""); setReading(file.name);
    try {
      setSource(buildRealSource(JSON.parse(await file.text())));
      setOpen(true);
    } catch (problem) {
      setError(`No pudimos abrir «${file.name}»: ${reason(problem)}`);
    }
    setReading("");
  };
  const drop = (event: DragEvent) => { event.preventDefault(); setOver(false); load(event.dataTransfer.files[0]); };
  if (open) return <Dashboard onChangeFile={() => setOpen(false)}/>;
  return <main className="start" onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }} onDrop={drop}>
    <section className="start-panel">
      <div className="brand"><span className="brand-symbol" aria-hidden="true"><span/><span/><span/><span/></span><span className="brand-text">Conecta<span>—</span>TE<small className="brand-subtitle">Universidad de los Andes</small></span></div>
      <p className="eyebrow">Adopción y acompañamiento</p>
      <h1>Abre el archivo del semestre para empezar.</h1>
      <p className="page-description">El tablero se arma con <strong>tablero.json</strong>, el archivo con el uso de las herramientas de Bloque Neón de cada profesor, semestre a semestre.</p>
      <p className="page-description">Lo genera cada semestre el proceso de datos de Conecta-TE en Databricks: descárgalo de allí y ábrelo aquí.</p>
      <div className="drop-zone" data-over={over || undefined}>
        <Icon name="upload" size={26}/>
        <p><strong>Arrastra aquí tablero.json</strong><span>o búscalo en tu computador</span></p>
        <label className="button button-primary file-button">Elegir el archivo<input className="sr-only" type="file" accept=".json,application/json" onChange={event => { load(event.target.files?.[0]); event.target.value = ""; }}/></label>
      </div>
      <p className="small muted" role="status">{reading && `Leyendo «${reading}»…`}</p>
      {error && <div className="callout" role="alert"><Icon name="info"/><div><strong>{error}</strong><p>Revisa que sea el tablero.json que descargaste de Databricks. Si el problema sigue, avísale al equipo de datos con este mensaje.</p></div></div>}
      <p className="small muted">El archivo se lee solo en este navegador: no se sube a ningún servidor y no se guarda. Al recargar o cerrar la página, el tablero lo vuelve a pedir.</p>
    </section>
  </main>;
}
