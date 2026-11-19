import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Every flow starts on the start screen and opens the v2 fixture, as a person opens tablero.json.
const FIXTURE = join(__dirname, "fixtures", "tablero-ejemplo.json");
type FileInput = Parameters<Locator["setInputFiles"]>[0];
const startHeading = (page: Page) => page.getByRole("heading", { name: "Abre el archivo del semestre para empezar.", exact: true });
const changeFile = (page: Page) => page.getByRole("button", { name: "Cambiar archivo", exact: true });

/** Picks a file on the start screen; retried until `shown` appears, since a pick before hydration is lost. */
async function choose(page: Page, files: FileInput, shown: Locator) {
  await expect(async () => {
    await page.getByLabel("Elegir el archivo", { exact: true }).setInputFiles(files, { timeout: 2_000 });
    await expect(shown).toBeVisible({ timeout: 2_000 });
  }).toPass();
}

async function openFile(page: Page, url = "/") {
  await page.goto(url);
  await expect(startHeading(page)).toBeVisible();
  await choose(page, FIXTURE, changeFile(page));
}

async function navigate(page: Page, label: string) {
  const mobileMenu = page.getByRole("button", { name: "Abrir menú", exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.getByRole("complementary", { name: "Navegación principal" })
    .getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

async function professorNameAt(page: Page, index: number) {
  const label = await page.locator("table tbody tr").nth(index)
    .getByRole("button", { name: /^Ver ficha de / }).getAttribute("aria-label");
  return label!.replace("Ver ficha de ", "");
}

async function assertNoBodyOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth), {
    message: "El cuerpo debe caber en el viewport cuando termina la transición del menú",
    timeout: 5_000,
  }).toBeLessThanOrEqual(1);
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  const diagnostic = overflow.document > overflow.viewport + 1 ? await page.locator("main *").evaluateAll(elements => elements
    .filter(element => !element.closest(".table-wrap") && element.getBoundingClientRect().right > window.innerWidth + 1)
    .map(element => ({ tag: element.tagName, class: element.className, right: Math.round(element.getBoundingClientRect().right), width: Math.round(element.getBoundingClientRect().width) }))
    .sort((a, b) => b.right - a.right)
    .slice(0, 8)) : [];
  expect(overflow.document, `Elementos fuera del viewport: ${JSON.stringify(diagnostic)}`).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.body).toBeLessThanOrEqual(overflow.viewport + 1);
}

test("un agregado abre sus profesores y conserva el contexto al navegar atrás", async ({ page }) => {
  await openFile(page);
  // The comparison between tools is a second level of the summary.
  await page.getByText(/^Comparar con otras herramientas/).click();
  await page.locator(".state-filter", { hasText: "No expuesto" }).click();
  const aggregate = page.getByRole("button", { name: /^Rúbricas: \d+ de \d+ en No expuesto\. Ver profesores$/ });
  await expect(aggregate).toBeVisible();
  const label = await aggregate.getAttribute("aria-label");
  const count = Number(label!.match(/Rúbricas: (\d+)/)![1]);
  expect(count).toBeGreaterThan(0);
  await aggregate.click();
  await expect(page.getByRole("heading", { level: 1, name: "Elige a quién invitar al taller de Rúbricas" })).toBeVisible();
  await expect(page.getByLabel("Herramienta", { exact: true })).toHaveValue("rubricas");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  await expect(page.getByRole("heading", { name: new RegExp(`^${count} profesor`) })).toBeVisible();
  const states = await page.locator("table tbody .state-badge").allTextContents();
  expect(states.length).toBeGreaterThan(0);
  expect(states.every(state => state === "No expuesto")).toBe(true);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: /^¿A quién invitar al taller de/ })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  await expect(page.getByLabel("Herramienta", { exact: true })).toHaveValue("rubricas");
});

test("la convocatoria conserva personas fuera de los filtros y después de recargar", async ({ page }) => {
  await openFile(page, "/?vista=profesores");
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toBeVisible();
  const names = [await professorNameAt(page, 0), await professorNameAt(page, 1)];
  for (const name of names) await page.getByRole("checkbox", { name: `Seleccionar a ${name}`, exact: true }).check();
  await expect(page.getByRole("banner").getByRole("button", { name: "Convocatoria (2)", exact: true })).toBeVisible();
  await page.getByLabel("Buscar profesor", { exact: true }).fill("ninguna-persona-coincide-98231");
  await expect(page.getByRole("heading", { name: "Nadie con «ninguna-persona-coincide-98231» en esta lista" })).toBeVisible();
  await expect(page.getByText("0 de las 2 marcadas para este taller están en esta lista; 2 no se ven por los filtros de ahora, pero siguen en la convocatoria.", { exact: true })).toBeVisible();

  await page.reload();
  await expect(startHeading(page)).toBeVisible();
  await choose(page, FIXTURE, changeFile(page));
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toHaveValue("ninguna-persona-coincide-98231");
  await page.getByRole("banner").getByRole("button", { name: "Convocatoria (2)", exact: true }).click();
  const selection = page.getByRole("dialog", { name: "Tu próxima convocatoria" });
  await expect(selection).toBeVisible();
  for (const name of names) await expect(selection.getByText(name, { exact: true })).toBeVisible();
  await expect(selection.getByText("2 profesores de la convocatoria no se ven con los filtros actuales de la lista; igual se descargan.", { exact: true })).toBeVisible();
  // The list each person was marked from lives in memory: after a reload the dialog says the file will not carry it.
  await expect(selection.getByText(/^2 personas se marcaron antes de recargar la página o de cambiar de archivo/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(selection).not.toBeVisible();
});

test("una ficha asocia varias herramientas a la misma persona y el CSV no la duplica", async ({ page }) => {
  await openFile(page, "/?vista=profesores&herramienta=rubricas");
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toBeVisible();
  const name = await professorNameAt(page, 0);
  await page.getByRole("button", { name: `Ver ficha de ${name}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name, exact: true });
  await expect(detail.getByLabel("Herramienta de la ficha", { exact: true })).toHaveValue("rubricas");
  await detail.getByRole("button", { name: /^Agregar a la convocatoria del taller «/ }).click();
  await expect(detail.getByRole("button", { name: /^Quitar de la convocatoria del taller «/ })).toBeVisible();
  await detail.getByLabel("Herramienta de la ficha", { exact: true }).selectOption("contenidos");
  // Viewing another tool keeps the list's workshop button and adds one for the tool being viewed.
  await expect(detail.getByRole("button", { name: /^Quitar de la convocatoria del taller «/ })).toHaveCount(1);
  await detail.getByRole("button", { name: /^Agregar a la convocatoria del taller «/ }).click();
  await expect(detail.getByRole("button", { name: /^Quitar de la convocatoria del taller «/ })).toHaveCount(2);
  await detail.getByLabel("Herramienta de la ficha", { exact: true }).selectOption("rubricas");
  await expect(detail.getByRole("button", { name: /^Quitar de la convocatoria del taller «/ })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("banner").getByRole("button", { name: "Convocatoria (1)", exact: true }).click();
  const selection = page.getByRole("dialog", { name: "Tu próxima convocatoria" });
  await expect(selection.getByText(name, { exact: true })).toHaveCount(1);
  await expect(selection.getByText("Rúbricas", { exact: true })).toBeVisible();
  await expect(selection.getByText("Contenidos", { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await selection.getByRole("button", { name: "Descargar lista (1 profesor)", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("convocatoria-conectate-taller-2026-1-datos-2025-2.csv");
  const csv = await readFile((await download.path())!, "utf8");
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("Profesor");
  expect(lines[1]).toContain(name);
  expect(lines[1]).toContain("Contenidos | Rúbricas");
  expect(lines[1]).toContain("Datos reales de Brightspace · uso interno");
});

test("la lista de un taller abre en quienes aún no la usan, por probabilidad, y deja ver a todos", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  await navigate(page, "Elegir profesores");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  await expect(page.getByLabel("Ordenar por", { exact: true })).toHaveValue("probability");
  const states = await page.locator("table tbody .state-badge").allTextContents();
  expect(states.length).toBeGreaterThan(0);
  expect(states.every(state => state === "No expuesto")).toBe(true);
  await page.getByRole("button", { name: /^Ver a todos \(\d+\): limpiar filtros$/ }).click();
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Todos");

  // A configuration-only tool opens on those who do not have it configured.
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("lockdown");
  await navigate(page, "Talleres y herramientas");
  await page.getByRole("button", { name: "Armar la lista de este taller" }).click();
  await expect(page.getByLabel("¿La tiene configurada en 2025-2?", { exact: true })).toHaveValue("no");
});

test("una búsqueda sin coincidencias lo dice y permite borrarla o restablecer la lista", async ({ page }) => {
  await openFile(page, "/?vista=profesores");
  const search = page.getByLabel("Buscar profesor", { exact: true });
  await search.fill("persona-inexistente-67258");
  await expect(page.getByRole("heading", { name: "Nadie con «persona-inexistente-67258» en esta lista" })).toBeVisible();
  await expect(page.getByText(/búsqueda «persona-inexistente-67258»/)).toBeVisible();
  await page.getByRole("button", { name: "Borrar la búsqueda", exact: true }).click();
  await expect(search).toHaveValue("");
  await search.fill("persona-inexistente-67258");
  await page.locator(".empty-state").getByRole("button", { name: "Limpiar filtros de la lista", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Todos");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("la validación aclara su objetivo y conserva la evaluación global al cambiar facultad", async ({ page }) => {
  await openFile(page);
  await navigate(page, "Grupos parecidos");
  // Grupos compares the workshop's state first.
  await page.getByRole("button", { name: /profesores clasificados en No expuesto;.*Ver grupo\./ }).first().click();
  const facultySelect = page.getByLabel("Facultad", { exact: true });
  const faculty = await facultySelect.locator("option").nth(1).getAttribute("value");
  // An option without an explicit value uses its visible text as the value.
  const facultyValue = faculty ?? await facultySelect.locator("option").nth(1).innerText();
  await facultySelect.selectOption(facultyValue);
  await navigate(page, "Pronóstico");
  // In the fixture, Rúbricas is a tool with a start in the last semester reviewed.
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("rubricas");
  await expect(page.getByText("Probabilidad de que configure Rúbricas la próxima vez que dicte (2026-1), calculada con los datos de 2025-2.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "¿Qué tan bien acierta?", exact: true }).click();
  await expect(page.getByText("Revisión de Rúbricas con datos reales de todas las facultades y grupos.", { exact: true })).toBeVisible();
  await expect(page.getByText(/no se aplican los filtros de facultad ni de grupo/)).toBeVisible();
  const initialEvaluation = await page.locator(".metrics-grid .metric-value").allTextContents();
  await facultySelect.selectOption("Todos");
  await expect(page.locator(".metrics-grid .metric-value")).toHaveText(initialEvaluation);
  // The cut starts where the rest of the dashboard says «probabilidad alta».
  await expect(page.getByText("(el corte de «probabilidad alta»)", { exact: true })).toBeVisible();
  await expect(page.locator(".validation-verdict")).toContainText("En pocas palabras:");
  await page.getByRole("slider", { name: "Corte de probabilidad para esta revisión" }).focus();
  await page.keyboard.press("Home");
  await expect(page.getByText("De quienes la configuraron, habríamos señalado a", { exact: true }).locator("..").locator(".metric-value")).toHaveText("100 %");
  await page.getByText("¿Acierta más que una regla simple? (comparación y detalle de cálculo)", { exact: true }).click();
  await expect(page.getByRole("columnheader", { name: "Error del pronóstico (Brier)", exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Error de la regla simple (Brier)", exact: true })).toBeVisible();
  await expect(page.getByText(/nunca usa el resultado del semestre que intenta anticipar/)).toBeVisible();
});

test("en móvil se navegan las cinco vistas sin desbordamiento y Escape cierra las fichas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFile(page);
  const views = [
    ["Resumen", /^¿A quién invitar al taller de/],
    ["Talleres y herramientas", /^.* y su taller$/],
    ["Elegir profesores", /^Elige a quién invitar al taller de/],
    ["Grupos parecidos", /^Buscar por grupos parecidos/],
    ["Pronóstico", /^¿Quién podría configurar/],
  ] as const;
  for (const [label, heading] of views) {
    await navigate(page, label);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toHaveAttribute("aria-expanded", "false");
    await assertNoBodyOverflow(page);
  }
  // The closed phone menu is out of sight and out of the keyboard order.
  await expect(page.getByRole("complementary", { name: "Navegación principal" })).toBeHidden();
  await page.getByRole("button", { name: "Guía: el pronóstico", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Guía del tablero" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Elegir profesores");
  // One control clears the list: «Ver a todos», next to what is shown.
  await page.getByRole("button", { name: /^Ver a todos \(\d+\): limpiar filtros$/ }).click();
  const name = await professorNameAt(page, 0);
  await page.getByRole("button", { name: `Ver ficha de ${name}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
  await assertNoBodyOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("un archivo que no es tablero.json muestra un error claro y deja elegir otro", async ({ page }) => {
  await page.goto("/");
  // Next.js keeps its own empty role="alert" for route changes.
  const alert = page.getByRole("alert").filter({ hasText: "No pudimos abrir" });
  await choose(page, { name: "notas.json", mimeType: "application/json", buffer: Buffer.from('{"hola": 1}') }, alert);
  await expect(alert).toContainText("No pudimos abrir «notas.json». No es un tablero.json del proceso de datos de Conecta-TE");
  // The message takes the focus, so it is seen and read at once.
  await expect(alert).toBeFocused();
  await expect(alert.getByText(/^Detalle para el equipo de datos$/)).toBeVisible();
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from("esto no es JSON") }, alert.getByText(/tablero\.json»\. Su contenido no es el de un tablero\.json/));
  await expect(alert).toContainText("Si ya elegiste ese y el mensaje sigue, pídele a ese equipo un archivo nuevo y envíale este mensaje");
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from('{"contrato": "tabl') }, alert.getByText(/tablero\.json»\. Está cortado o dañado: parece que la descarga no terminó\./));
  // Each kind of problem has its own action: a cut download is downloaded again.
  await expect(alert).toContainText("Qué hacer: Descárgalo de nuevo y elige el archivo nuevo.");
  await choose(page, { name: "convocatoria.csv", mimeType: "text/csv", buffer: Buffer.from('"Profesor";"Código"') }, alert.getByText(/convocatoria\.csv»\. Es una lista \.csv/));
  await expect(alert).toContainText("Qué hacer: Este tablero no abre listas .csv. Elige el archivo que se llama tablero.json");
  const broken = JSON.parse(await readFile(FIXTURE, "utf8"));
  broken.uso.rubricas.efectiva.pop();
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(broken)) }, alert.getByText(/tablero\.json»\. Tiene un error por dentro/));
  await alert.getByText("Detalle para el equipo de datos", { exact: true }).click();
  await expect(alert.getByText(/las columnas de filas y uso no tienen el mismo largo/)).toBeVisible();
  await expect(changeFile(page)).toHaveCount(0);
  await choose(page, FIXTURE, changeFile(page));
  // The opened dashboard is announced: its title takes the focus.
  await expect(page.getByRole("heading", { level: 1, name: /^¿A quién invitar al taller de/ })).toBeFocused();
});

test("también se abre arrastrando el archivo a la pantalla inicial", async ({ page }) => {
  // With a mouse the hint stays even in a narrow window.
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/");
  await expect(page.getByText("o arrástralo a este recuadro", { exact: true })).toBeVisible();
  const text = await readFile(FIXTURE, "utf8");
  await expect(async () => {
    const dataTransfer = await page.evaluateHandle(json => { const files = new DataTransfer(); files.items.add(new File([json], "tablero.json", { type: "application/json" })); return files; }, text);
    await page.dispatchEvent(".drop-zone", "drop", { dataTransfer });
    await expect(changeFile(page)).toBeVisible({ timeout: 2_000 });
  }).toPass();
});

test("Cambiar archivo vuelve a la pantalla inicial y el tablero se rehace con el archivo nuevo", async ({ page }) => {
  await openFile(page);
  const nav = page.getByRole("complementary", { name: "Navegación principal" });
  await expect(nav.getByRole("button", { name: /^Pronóstico 2026-1/ })).toBeVisible();
  await changeFile(page).click();
  // The screen change is announced: the title says what to do and takes the focus.
  const again = page.getByRole("heading", { level: 1, name: "Elige el archivo nuevo o vuelve al tablero." });
  await expect(again).toBeFocused();
  await expect(page.getByText(/datos hasta 2025-2, generados el /)).toBeVisible();
  await expect(nav).toHaveCount(0);
  // A mistaken tap goes back to the file that was open.
  await page.getByRole("button", { name: "Volver al tablero con el archivo que ya estaba abierto" }).click();
  await expect(nav.getByRole("button", { name: /^Pronóstico 2026-1/ })).toBeVisible();
  await changeFile(page).click();
  // A wrong file keeps the open one, and the message itself offers the way back.
  const alert = page.getByRole("alert").filter({ hasText: "No pudimos abrir" });
  await choose(page, { name: "notas.json", mimeType: "application/json", buffer: Buffer.from('{"hola": 1}') }, alert);
  await expect(alert.getByRole("button", { name: /^Volver al tablero \(sigue abierto «/ })).toBeVisible();
  const next = JSON.parse(await readFile(FIXTURE, "utf8"));
  next.pronostico.destino = "202620";
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(next)) }, changeFile(page));
  await expect(nav.getByRole("button", { name: /^Pronóstico 2026-2/ })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Pronóstico 2026-1/ })).toHaveCount(0);
});

test("al recargar la página vuelve a pedir el archivo y no guarda sus datos", async ({ page }) => {
  await openFile(page, "/?vista=profesores");
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toBeVisible();
  await page.reload();
  await expect(startHeading(page)).toBeVisible();
  await expect(changeFile(page)).toHaveCount(0);
  const stored = await page.evaluate(async () => ({ local: JSON.stringify({ ...localStorage }), session: JSON.stringify({ ...sessionStorage }), databases: (await indexedDB.databases()).map(db => db.name).filter(name => !name?.startsWith("__next")) }));
  expect(stored.local).not.toMatch(/D-[0-9a-f]{8}/);
  expect(stored.session).toBe("{}");
  // `next dev` opens its own debug database; the app opens none.
  expect(stored.databases).toEqual([]);
});

/** The fixture with every professor copied `copies` times (new codes), so a list has more than one page. */
async function enlarged(copies: number) {
  const data = JSON.parse(await readFile(FIXTURE, "utf8"));
  const people = data.profesores.id.length;
  const copy = (columns: Record<string, unknown[]>, from: number, professor: number) => { for (const [key, column] of Object.entries(columns)) column.push(key === "profesor" ? professor : column[from]); };
  for (let k = 1; k < copies; k++) for (let i = 0; i < people; i++) {
    const professor = data.profesores.id.length;
    data.profesores.id.push(`D-${(0x10000000 + k * 16 + i).toString(16)}`);
    data.profesores.facultad.push(data.profesores.facultad[i]); data.profesores.contrato.push(data.profesores.contrato[i]);
    const rows = data.filas.profesor.flatMap((owner: number, row: number) => owner === i ? [row] : []);
    for (const row of rows) { copy(data.filas, row, professor); for (const use of Object.values(data.uso) as Record<string, unknown[]>[]) copy(use, row, professor); }
    for (const at of data.pronosticos.profesor.flatMap((owner: number, j: number) => owner === i ? [j] : [])) copy(data.pronosticos, at, professor);
    for (const at of data.perfil_siguiente.profesor.flatMap((owner: number, j: number) => owner === i ? [j] : [])) copy(data.perfil_siguiente, at, professor);
  }
  return { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(data)) };
}

test("el Resumen y Talleres abren la misma lista del taller", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  // The highlighted card of the summary is the workshop list, as «Armar la lista de este taller».
  await page.locator(".list-card .button-primary").click();
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  const fromSummary = page.url();
  await navigate(page, "Talleres y herramientas");
  await page.getByRole("button", { name: "Armar la lista de este taller" }).click();
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  expect(page.url()).toBe(fromSummary);
});

test("en una lista sin probabilidad el orden es por código y lo dice", async ({ page }) => {
  await openFile(page, "/?vista=profesores&herramienta=contenidos&estado=Usa");
  await expect(page.getByLabel("Ordenar por", { exact: true })).toHaveValue("code");
  await expect(page.getByText(/Aquí nadie tiene probabilidad: .* El orden es por código\./)).toBeVisible();
  // With one state chosen, «Qué conversar» is said once above the table.
  await expect(page.getByText("Qué conversar con quienes están en Usa:", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^Qué conversar/ })).toHaveCount(0);
  // A search that finds someone outside the probability filter says that person exists and why there is no probability.
  const code = await professorNameAt(page, 0);
  await page.goto(`/?vista=profesores&herramienta=contenidos&probabilidad=Con+estimaci%C3%B3n&buscar=${code}`);
  await choose(page, FIXTURE, changeFile(page));
  await expect(page.getByRole("heading", { name: "Nadie aquí tiene ese rango de probabilidad", exact: true })).toBeVisible();
  await expect(page.getByText(/^Con los otros filtros hay 1 profesor, pero no tiene probabilidad calculada\./)).toBeVisible();
  await page.getByRole("button", { name: "Quitar el filtro de probabilidad", exact: true }).click();
  await expect(page.getByRole("button", { name: `Ver ficha de ${code}`, exact: true })).toBeVisible();
});

test("con dos talleres hay cupo por taller y cupo total, y en el total cada persona cuenta una vez", async ({ page }) => {
  await openFile(page, "/?vista=profesores&herramienta=rubricas");
  const names = [await professorNameAt(page, 0), await professorNameAt(page, 1)];
  for (const name of names) await page.getByRole("checkbox", { name: `Seleccionar a ${name}`, exact: true }).check();
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("contenidos");
  // On the list, another tool opens its workshop list; this test needs everyone.
  await page.getByRole("button", { name: /^Ver a todos \(\d+\): limpiar filtros$/ }).click();
  await page.getByLabel("Buscar profesor", { exact: true }).fill(names[0]);
  await page.getByRole("checkbox", { name: `Seleccionar a ${names[0]}`, exact: true }).check();
  await page.getByRole("banner").getByRole("button", { name: "Convocatoria (2)", exact: true }).click();
  const selection = page.getByRole("dialog", { name: "Tu próxima convocatoria" });
  await selection.getByRole("spinbutton", { name: "Cupo total (opcional)", exact: true }).fill("1");
  await expect(selection.getByText("Cupo total (cada persona cuenta una vez): sobra 1 persona (2 marcadas, cupo de 1).", { exact: false })).toBeVisible();
  await selection.getByRole("spinbutton", { name: "Cupo total (opcional)", exact: true }).fill("3");
  await expect(selection.getByText("Cupo total (cada persona cuenta una vez): caben todos, 2 de 3 lugares; quedan 1 libre.", { exact: true })).toBeVisible();
});

test("marcar a toda la lista, el cupo por taller y el criterio viajan al archivo", async ({ page }) => {
  await page.goto("/?vista=profesores&herramienta=rubricas");
  await expect(startHeading(page)).toBeVisible();
  await choose(page, await enlarged(5), changeFile(page));
  const all = page.getByRole("button", { name: /^Marcar a los (\d+) de esta lista \(todas las páginas\)$/ });
  const total = Number((await all.innerText()).match(/\d+/)![0]);
  expect(total).toBeGreaterThan(10);
  // The short label fits its column; the full count stays in the tooltip.
  await expect(page.locator("th .select-page")).toHaveAttribute("title", `Marcar a los 10 de esta página (de ${total})`);
  await all.click();
  await expect(page.getByRole("button", { name: `Desmarcar a los ${total} de esta lista`, exact: true })).toBeVisible();
  await page.getByRole("spinbutton", { name: "Cupo del taller de Rúbricas" }).fill(String(total - 2));
  await expect(page.getByText(`Cupo de este taller: sobran 2 personas (${total} marcadas, cupo de ${total - 2})`, { exact: true })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: `Convocatoria (${total})`, exact: true }).click();
  const selection = page.getByRole("dialog", { name: "Tu próxima convocatoria" });
  // The quota is the same one, per workshop.
  await expect(selection.getByRole("spinbutton", { name: "Cupo del taller de Rúbricas" })).toHaveValue(String(total - 2));
  await expect(selection.getByText(/^Taller de Rúbricas: sobran 2 personas/)).toBeVisible();
  await selection.getByLabel("Nota para el archivo (opcional)", { exact: true }).fill("desempate por facultad");
  const downloadPromise = page.waitForEvent("download");
  await selection.getByRole("button", { name: `Descargar lista (${total} profesores)`, exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, "utf8");
  const [header, first] = csv.replace(/^﻿/, "").trim().split(/\r?\n/);
  expect(header).toContain('"Antecedente de la probabilidad";"Nota"');
  expect(first).toContain("Elegido en el tablero (Rúbricas: lista «Todos los estados · 2025-2»");
  expect(first).toMatch(/datos generados el .+ · lista descargada el \d{4}-\d{2}-\d{2}/);
  expect(first.endsWith(`"desempate por facultad";"Rúbricas: ${total - 2}"`)).toBe(true);
});

test("un semestre anterior se avisa arriba y deja volver al más reciente", async ({ page }) => {
  await openFile(page, "/?vista=profesores");
  await page.getByLabel("Semestre", { exact: true }).selectOption("202410");
  const notice = page.locator(".old-period");
  await expect(notice).toContainText("Estás mirando 2024-1, no 2025-2, el semestre más reciente.");
  await notice.getByRole("button", { name: "Volver a 2025-2", exact: true }).click();
  await expect(page.getByLabel("Semestre", { exact: true })).toHaveValue("202520");
  await expect(notice).toHaveCount(0);
});

test("en móvil el menú toma el foco, Escape lo cierra y tocar un grupo muestra su detalle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFile(page);
  const menu = page.getByRole("button", { name: "Abrir menú", exact: true });
  await menu.click();
  await expect(page.getByRole("complementary", { name: "Navegación principal" }).getByRole("button", { name: /^Resumen/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await expect(page).toHaveTitle("Resumen · Conecta-TE");
  await navigate(page, "Grupos parecidos");
  await page.locator(".group-card").first().click();
  const detail = page.getByRole("region", { name: "Detalle del grupo seleccionado" });
  await expect(detail).toBeFocused();
  await expect(detail).toBeInViewport();
});

test("en la lista, otra herramienta abre su lista de taller y Grupos parecidos no cambia el filtro", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  await navigate(page, "Elegir profesores");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  await navigate(page, "Grupos parecidos");
  await page.getByLabel("Estado que quieres comparar").selectOption("Adopta");
  await navigate(page, "Elegir profesores");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("No expuesto");
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("contenidos");
  await expect(page.getByLabel("Estado en Contenidos (2025-2)", { exact: true })).toHaveValue("No expuesto");
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("lockdown");
  await expect(page.getByLabel("¿La tiene configurada en 2025-2?", { exact: true })).toHaveValue("no");
});

test("«Ver qué tan bien acierta» abre la revisión con los dos semestres, las mismas cifras del resto del tablero", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  await page.getByRole("button", { name: "Ver qué tan bien acierta", exact: true }).click();
  await expect(page.getByRole("button", { name: "¿Qué tan bien acierta?", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Semestre revisado")).toHaveValue("Todos");
  await page.getByRole("button", { name: "Quién podría empezar", exact: true }).click();
  // The reasons to trust the forecast are gathered at the top.
  await expect(page.getByRole("region", { name: "Por qué creerle" })).toContainText("Se probó a ciegas");
});

test("con un cupo, la lista ofrece marcar a los primeros y avisa a quiénes deja un empate", async ({ page }) => {
  await page.goto("/?vista=profesores&herramienta=rubricas");
  await expect(startHeading(page)).toBeVisible();
  // Five copies of each person: every probability is shared by five people.
  await choose(page, await enlarged(5), changeFile(page));
  await page.getByRole("spinbutton", { name: "Cupo del taller de Rúbricas" }).fill("7");
  // The page follows the quota, and the cut at place 7 falls inside a tie.
  await expect(page.getByLabel("Filas por página")).toHaveValue("7");
  const tie = page.locator(".quota-tie");
  await expect(tie).toContainText("elige 2 de estas 5 personas");
  await tie.getByRole("button", { name: /^Ver aquí a las 5 personas con / }).click();
  await expect(page.locator("tbody tr[data-tied]")).toHaveCount(5);
  await expect(page.getByRole("checkbox", { name: /más que el cupo de 7$/ })).toBeVisible();
  await page.getByRole("button", { name: "Marcar a los primeros 5 (antes del empate)", exact: true }).click();
  await page.getByRole("banner").getByRole("button", { name: "Convocatoria (5)", exact: true }).click();
  const selection = page.getByRole("dialog", { name: "Tu próxima convocatoria" });
  // One workshop: it opens by workshop, highest probability first.
  await expect(selection.getByRole("button", { name: "Por taller", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(selection.getByText("5 profesores", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  // Filling the 2 places among the tied people ends the request to choose, and their reason says it was a tie-break.
  const tied = page.locator("tbody tr[data-tied] input[type=checkbox]");
  await tied.nth(0).check();
  await tied.nth(1).check();
  await expect(tie).toContainText(/Cupo completo:\s*marcaste a los primeros 5 y a 2 de las 5 personas con/);
  // The request to choose stays, folded, one tap away.
  await expect(tie.getByText(/Para los 2 lugares que quedan, elige 2/)).toBeHidden();
  // The tied people can still be hidden or shown again with one click.
  await expect(tie.getByRole("button", { name: "Volver a 7 por página", exact: true })).toBeVisible();
  await page.getByRole("banner").getByRole("button", { name: "Convocatoria (7)", exact: true }).click();
  // The mix of faculties and groups shows before downloading.
  await expect(selection.locator(".mix-line")).toContainText(/^Mezcla: 7 personas de \d+ facultad/);
  const downloadPromise = page.waitForEvent("download");
  await selection.getByRole("button", { name: "Descargar lista (7 profesores)", exact: true }).click();
  const csv = await readFile((await (await downloadPromise).path())!, "utf8");
  expect(csv.split(/\r?\n/).filter(line => line.includes("desempate: 2 lugares entre 5 personas con"))).toHaveLength(2);
});

test("en el teléfono, un error de archivo toma el foco y deja a la vista el botón para elegir otro", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const alert = page.getByRole("alert").filter({ hasText: "No pudimos abrir" });
  const old = JSON.parse(await readFile(FIXTURE, "utf8"));
  old.contrato = "tablero-adopcion/v1";
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(old)) }, alert);
  await expect(alert).toBeFocused();
  // An older file is the right one in an old format: the advice asks for a new one first.
  await expect(alert).toContainText("Qué hacer: Pídele al equipo de datos de Conecta-TE un archivo nuevo");
  await expect(page.locator(".file-button")).toBeInViewport();
});

test("al cambiar de página desde abajo, la nueva empieza arriba y en la lista cada grupo dice su semestre", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  // Instant, so no wheel animation is still running when the menu is clicked.
  await page.evaluate(() => window.scrollTo({ top: 2000, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await navigate(page, "Elegir profesores");
  await expect(page.getByRole("heading", { level: 1, name: /^Elige a quién invitar/ })).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  // The list's group is the previous semester's, and the row says which one.
  await expect(page.locator("tbody .group-when").first()).toHaveText(/^\d{4}-[12]:$/);
  // The decision before marking is one sentence next to the order it explains, not a separate box.
  await expect(page.locator(".list-context .order-why")).toContainText("Antes de marcar:");
  await expect(page.locator(".callout.decision")).toHaveCount(0);
});

test("en el Resumen, las listas se ven primero: caben con su botón en la primera pantalla", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFile(page);
  const buttons = page.locator(".list-card-go");
  expect(await buttons.count()).toBeGreaterThanOrEqual(2);
  for (const box of await buttons.evaluateAll(els => els.map(el => el.getBoundingClientRect().bottom))) expect(box).toBeLessThanOrEqual(900);
  // The list cards are read before the tool's figures.
  const [card, metrics] = await Promise.all([page.locator(".list-card").first().boundingBox(), page.locator(".metrics-grid").boundingBox()]);
  expect(card!.y).toBeLessThan(metrics!.y);
  // Each card keeps its full sentence for screen readers and its detail one tap away.
  await expect(page.getByRole("region", { name: "Para empezar a usarla" }).getByRole("button", { name: /^Ver a los \d+: no la han usado con estudiantes desde .* \(No expuesto\)$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Quienes dejaron de usar / }).getByText("Ver detalle", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("combobox", { name: "Herramienta", exact: true })).toBeHidden();
  // The example file adds a «pocos profesores» notice above; with the real file the first button ends near y≈745.
  const first = await page.locator(".list-card").first().boundingBox();
  expect(first!.y).toBeLessThan(844 * .8);
  // On a phone «Qué estás mirando» is one line; «Cambiar» opens the same selectors.
  await page.getByRole("button", { name: /^Rúbricas · .*Cambiar$/ }).click();
  await expect(page.getByRole("combobox", { name: "Herramienta", exact: true })).toBeVisible();
  await expect(page.locator(".global-filters-label")).toBeVisible();
});

test("la franja de pasos dice cuántos van marcados y su paso 3 abre la convocatoria", async ({ page }) => {
  await openFile(page, "/?vista=profesores&herramienta=rubricas");
  const steps = page.getByRole("list", { name: "Cómo armar una convocatoria, en 3 pasos" });
  await expect(steps.locator("li[aria-current=step]")).toHaveText(/Marca a quién invitar/);
  const name = await professorNameAt(page, 0);
  await page.getByRole("checkbox", { name: `Seleccionar a ${name}`, exact: true }).check();
  await steps.getByRole("button", { name: /^Revisar convocatoria\s*1 marcado$/ }).click();
  await expect(page.getByRole("dialog", { name: "Tu próxima convocatoria" })).toBeVisible();
});

test("el aviso de empate se lee como una sola frase", async ({ page }) => {
  await page.goto("/?vista=profesores&herramienta=rubricas");
  await expect(startHeading(page)).toBeVisible();
  // Four copies of each of the 3 people: places 10 to 12 share a probability, across the page cut.
  await choose(page, await enlarged(4), changeFile(page));
  const bold = page.locator(".callout p > strong", { hasText: /en la página siguiente$/ });
  await expect(bold).toBeVisible();
  expect(await bold.evaluate(el => getComputedStyle(el).display)).toBe("inline");
});

test("el cupo se pregunta en el Resumen, cada lista dice si cabe y la lista lo conserva", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  // The title takes the focus to be announced, without a frame that looks like a selection.
  const title = page.getByRole("heading", { level: 1, name: /^¿A quién invitar al taller de/ });
  await expect(title).toBeFocused();
  expect(await title.evaluate(el => getComputedStyle(el).outlineStyle)).toBe("none");
  const first = page.getByRole("region", { name: "Para empezar a usarla" });
  await expect(first).toContainText("Todos los que podrían ir.");
  await page.getByRole("spinbutton", { name: "Cupo del taller de Rúbricas" }).fill("2");
  await expect(first.locator(".list-card-fit")).toHaveText(/^Son más que el cupo de 2: toma a los primeros 2\.\s*$/);
  await first.locator(".button-primary").click();
  await expect(page.getByRole("spinbutton", { name: "Cupo del taller de Rúbricas" })).toHaveValue("2");
  await expect(page.getByLabel("Filas por página")).toHaveValue("2");
});

test("la barra de la convocatoria dice qué facultades faltan en la mezcla", async ({ page }) => {
  await openFile(page, "/?vista=profesores&herramienta=rubricas");
  for (const index of [0, 1]) await page.getByRole("checkbox", { name: `Seleccionar a ${await professorNameAt(page, index)}`, exact: true }).check();
  await expect(page.locator(".selection-tray")).toContainText(/Mezcla de este taller: \d+ facultad(es)? de \d+(; faltan? [^·]+)? · \d+ de los \d+ grupos \(en \d{4}-[12]\)/);
});

test("en el Resumen, lo que respalda las listas se ve con título propio y la tarjeta de probabilidad alta dice si cambia la convocatoria", async ({ page }) => {
  await openFile(page, "/?herramienta=rubricas");
  // The rule to choose sits on the first card, not in a paragraph below.
  await expect(page.getByRole("region", { name: "Para empezar a usarla" }).locator(".list-card-start")).toHaveText("Si no sabes cuál elegir, empieza por esta.");
  const backing = page.getByRole("region", { name: "Lo que respalda estas listas" });
  await expect(backing).toContainText("¿Por qué creerle a la probabilidad?");
  await expect(backing).toContainText(/en promedio, \d+ \([\d.]+ de [\d.]+\)/);
  await expect(backing).toContainText("¿Qué son los grupos?");
  // The long explanation of how the lists cross stays one tap away.
  await expect(page.getByText(/^Cada opción abre una lista/)).toBeHidden();
  await page.getByText("Ver más: cómo se cruzan las listas y cuál elegir", { exact: true }).click();
  await expect(page.getByText(/^Cada opción abre una lista/)).toBeVisible();
  const high = page.getByRole("region", { name: "Para concentrarte en quienes probablemente empiecen" });
  await page.getByRole("spinbutton", { name: "Cupo del taller de Rúbricas" }).fill("2");
  await expect(high.locator(".list-card-compare")).toHaveText(/entre los primeros 2 de la primera lista/);
});
