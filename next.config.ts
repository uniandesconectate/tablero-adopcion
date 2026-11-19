import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { NextConfig } from "next";

// Real data is opt-in (TABLERO_FUENTE=real): a build never bundles teacher data just because the git-ignored file exists.
const { TABLERO_DATOS, TABLERO_FUENTE } = process.env;
if (TABLERO_FUENTE && !["sintetica", "real"].includes(TABLERO_FUENTE)) throw new Error(`TABLERO_FUENTE solo acepta "sintetica" o "real" y llegó "${TABLERO_FUENTE}".`);
const file = relative(process.cwd(), resolve(TABLERO_DATOS ?? "datos/real/tablero.json"));
if (TABLERO_DATOS && !existsSync(file)) throw new Error(`TABLERO_DATOS apunta a un archivo que no existe: ${TABLERO_DATOS}.`);
// Turbopack does not resolve files outside the project folder.
if (TABLERO_DATOS && file.startsWith("..")) throw new Error("TABLERO_DATOS debe apuntar a un archivo dentro de la carpeta del tablero.");
const real = TABLERO_FUENTE === "real";
if (real && !existsSync(file)) throw new Error(`TABLERO_FUENTE=real pide el archivo ${file}: genéralo con experimentos/02_trayectorias/03_markov_k5_experimentos/exportar_tablero.py.`);

// Publishing as a static page (GitHub Pages) sets PAGES_BASE_PATH; a published page never carries real data.
const pages = process.env.PAGES_BASE_PATH;
if (pages !== undefined && real) throw new Error("Una página publicada no puede llevar datos reales: quita TABLERO_FUENTE=real.");

const config: NextConfig = {
  ...(pages !== undefined ? { output: "export" as const, basePath: pages } : {}),
  devIndicators: false,
  turbopack: real ? { resolveAlias: { "@fuente": "./src/lib/real.ts", "@datos-reales": `./${file}` } } : {},
};
export default config;
