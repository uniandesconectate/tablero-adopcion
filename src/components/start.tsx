"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { TEXTS, setSource } from "@/lib/data";
import { DEFAULT_PERIOD, formatPeriod } from "@/lib/domain";
import { buildRealSource } from "@/lib/real";
import Dashboard from "./dashboard";
import { Icon } from "./ui";

const PREFIX = "Datos reales (tablero.json): ";
const TECHNICAL = " (Para el equipo de datos: ";
const ASK = "Pídele al equipo de datos de Conecta-TE un archivo nuevo y envíale este mensaje (botón «Copiar el mensaje»).";
const AGAIN = "Descárgalo de nuevo y elige el archivo nuevo. Si vuelve a pasar, pídele al equipo de datos de Conecta-TE que te lo envíe otra vez.";
const OTHER = "Elige el archivo que se llama tablero.json, el que te dio el equipo de datos de Conecta-TE.";
interface Problem { title: string; todo: string; detail: string }
/** Why a file is not a valid tablero.json, what to do about it (one action per kind of problem) and the detail for the data team. */
function reason(error: unknown, text: string, name: string): [string, string, string] {
  if (error instanceof SyntaxError) {
    if (!text.trim()) return ["está vacío.", AGAIN, ""];
    if (text.trimStart().startsWith("{")) return ["está cortado o dañado: parece que la descarga no terminó.", AGAIN, ""];
    // The call list this dashboard downloads is a .csv: the likeliest mix-up.
    return [/\.csv$/i.test(name) ? "es una lista .csv, como la convocatoria que descarga este tablero, no un tablero.json." : "su contenido no es el de un tablero.json.", `${OTHER} Si ya elegiste ese y el mensaje sigue, pídele a ese equipo un archivo nuevo y envíale este mensaje (botón «Copiar el mensaje»).`, ""];
  }
  if (!(error instanceof Error) || !error.message.startsWith(PREFIX)) return ["no tiene la estructura de tablero.json.", ASK, ""];
  const message = error.message.slice(PREFIX.length);
  const cut = message.indexOf(TECHNICAL);
  // Messages without a plain part are only for the data team.
  if (cut < 0) return ["tiene un error por dentro y el tablero no lo puede leer.", ASK, message];
  const plain = message.slice(0, cut);
  const todo = plain.startsWith("no es un tablero.json") ? `${OTHER} Si es ese, pídele a ese equipo el de este semestre y envíale este mensaje (botón «Copiar el mensaje»).` : plain.startsWith("le falta una parte") ? `Descárgalo de nuevo. Si sigue igual, ${ASK.replace(/^P/, "p")}` : ASK;
  return [plain, todo, message.slice(cut + TECHNICAL.length).replace(/\)$/, "")];
}

/** The app opens here: nothing is shown until a valid tablero.json is opened, and the file is kept only in this tab. */
export default function Start() {
  const [open, setOpen] = useState(false);
  // After «Cambiar archivo» the previous file stays loaded, so a mistaken tap can go back.
  const [loaded, setLoaded] = useState<{ name: string; about: string } | null>(null);
  const [reading, setReading] = useState("");
  const [error, setError] = useState<Problem | null>(null);
  const [copied, setCopied] = useState(false);
  const [over, setOver] = useState(false);
  const alert = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The message lands where the eyes are: focus also scrolls it into view.
  useEffect(() => { if (error) alert.current?.focus(); }, [error]);
  // Back from the dashboard, the screen change is announced by moving the focus to its title.
  useEffect(() => { if (!open && loaded) heading.current?.focus(); }, [open, loaded]);
  const load = async (file: File | undefined) => {
    if (!file) return;
    setError(null); setCopied(false); setReading(file.name);
    let text = "";
    try {
      text = await file.text();
      setSource(buildRealSource(JSON.parse(text)));
      setOpen(true); setLoaded({ name: file.name, about: `datos hasta ${formatPeriod(DEFAULT_PERIOD)}${TEXTS.generated ? `, generados el ${TEXTS.generated}` : ""}` });
    } catch (problem) {
      const [plain, todo, detail] = reason(problem, text, file.name);
      setError({ title: `No pudimos abrir «${file.name}»: ${plain}`, todo, detail });
    }
    setReading("");
  };
  const copy = async () => {
    if (!error) return;
    try { await navigator.clipboard.writeText(`${error.title}${error.detail ? `\n${error.detail}` : ""}`); setCopied(true); } catch { /* Without clipboard access the message stays on screen to copy by hand. */ }
  };
  const picker = (label: string, className: string) => <label className={className}>{label}<input className="sr-only" type="file" accept=".json,application/json" onChange={event => { load(event.target.files?.[0]); event.target.value = ""; }}/></label>;
  const drop = (event: DragEvent) => { event.preventDefault(); setOver(false); load(event.dataTransfer.files[0]); };
  if (open) return <Dashboard onChangeFile={() => setOpen(false)}/>;
  return <main className="start" onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false); }} onDrop={drop}>
    <section className="start-panel">
      <div className="brand"><span className="brand-symbol" aria-hidden="true"><span/><span/><span/><span/></span><span className="brand-text">Conecta<span>—</span>TE<small className="brand-subtitle">Universidad de los Andes</small></span></div>
      <p className="eyebrow">Adopción y acompañamiento</p>
      <h1 ref={heading} tabIndex={-1}>{loaded ? "Elige el archivo nuevo o vuelve al tablero." : "Abre el archivo del semestre para empezar."}</h1>
      {loaded && <div className="callout start-open"><Icon name="info"/><div><p>Ya tienes abierto <strong>«{loaded.name}»</strong> ({loaded.about}). Si eliges otro archivo, reemplaza a este; si el nuevo tiene un error, este sigue abierto. Tu convocatoria se mantiene para las personas que estén en el archivo nuevo.</p><button className="button button-secondary" onClick={() => setOpen(true)}>Volver al tablero con el archivo que ya estaba abierto <Icon name="arrow" size={15}/></button></div></div>}
      <p className="page-description">El tablero se arma con <strong>tablero.json</strong>, el archivo con el uso de las herramientas de Bloque Neón de cada profesor, semestre a semestre.</p>
      <p className="page-description">Lo prepara cada semestre el equipo de datos de Conecta-TE. Si no lo tienes, pídeselo a ese equipo.</p>
      <details className="context-help start-origin"><summary>¿De dónde sale este archivo?</summary><p>Lo genera el proceso de datos de Conecta-TE en Databricks, la plataforma donde ese equipo procesa los datos de Bloque Neón. Trae, por profesor y semestre, qué herramientas tiene configuradas y si sus estudiantes las usan, con un código seudónimo en lugar del nombre.</p></details>
      {error && <div ref={alert} tabIndex={-1} className="callout is-error" role="alert"><Icon name="info"/><div><strong>{error.title}</strong><p>Qué hacer: {error.todo}</p><div className="heading-links">{picker("Elegir otro archivo", "button button-secondary file-button")}<button className="text-link" onClick={copy}>{copied ? "Mensaje copiado" : "Copiar el mensaje"}</button></div>{error.detail && <details><summary>Detalle para el equipo de datos</summary><p>{error.detail}</p></details>}</div></div>}
      <div className="drop-zone" data-over={over || undefined}>
        <Icon name="upload" size={26}/>
        <p><strong>Tu archivo: tablero.json</strong><span className="drag-hint">o arrástralo a este recuadro</span></p>
        {picker("Elegir el archivo", "button button-primary file-button")}
      </div>
      <p className="small muted" role="status">{reading && `Leyendo «${reading}»…`}</p>
      <p className="start-privacy"><Icon name="info" size={17}/><span>El archivo se lee solo en este navegador: no se sube a ningún servidor y no se guarda. Al recargar o cerrar la página, el tablero lo vuelve a pedir. Lo único que este navegador recuerda es la lista de personas que marques para invitar a un taller (la «convocatoria»: sus códigos y talleres), hasta que la vacíes.</span></p>
    </section>
  </main>;
}
