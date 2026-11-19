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
  await expect(page.getByRole("heading", { name: "No hay profesores con estos criterios" })).toBeVisible();
  await expect(page.getByText("0 se ven en esta lista · 2 no se ven con los filtros actuales (siguen guardados)", { exact: true })).toBeVisible();

  await page.reload();
  await expect(startHeading(page)).toBeVisible();
  await choose(page, FIXTURE, changeFile(page));
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toHaveValue("ninguna-persona-coincide-98231");
  await page.getByRole("banner").getByRole("button", { name: "Convocatoria (2)", exact: true }).click();
  const selection = page.getByRole("dialog", { name: "Tu próxima convocatoria" });
  await expect(selection).toBeVisible();
  for (const name of names) await expect(selection.getByText(name, { exact: true })).toBeVisible();
  await expect(selection.getByText("2 profesores de la convocatoria no se ven con los filtros actuales de la lista; igual se descargan.", { exact: true })).toBeVisible();
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
  expect(download.suggestedFilename()).toBe("convocatoria-conectate-2025-2.csv");
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
  await page.getByRole("button", { name: /^Ver a todos \(\d+\)$/ }).click();
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Todos");

  // A configuration-only tool opens on those who do not have it configured.
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("lockdown");
  await navigate(page, "Talleres y herramientas");
  await page.getByRole("button", { name: "Armar la lista de este taller" }).click();
  await expect(page.getByLabel("¿La tiene configurada en 2025-2?", { exact: true })).toHaveValue("no");
});

test("una búsqueda sin coincidencias permite restablecer la lista", async ({ page }) => {
  await openFile(page, "/?vista=profesores");
  const search = page.getByLabel("Buscar profesor", { exact: true });
  await search.fill("persona-inexistente-67258");
  await expect(page.getByRole("heading", { name: "No hay profesores con estos criterios" })).toBeVisible();
  await page.getByRole("button", { name: "Limpiar filtros de la lista", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Todos");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("la validación aclara su objetivo y conserva la evaluación global al cambiar facultad", async ({ page }) => {
  await openFile(page);
  await navigate(page, "Grupos parecidos");
  await page.getByRole("button", { name: /profesores clasificados en Adopta;.*Ver grupo\./ }).first().click();
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
  await page.getByRole("slider", { name: "Punto de corte para evaluar la predicción" }).focus();
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
    ["Talleres y herramientas", /^Cómo está .* y a quién invitar a su taller$/],
    ["Elegir profesores", /^Elige a quién invitar al taller de/],
    ["Grupos parecidos", /^Busca por grupo a quién invitar/],
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
  // Grupos parecidos leaves the list on Adopta, and the fixture has nobody there.
  await page.getByRole("button", { name: "Limpiar filtros de la lista", exact: true }).click();
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
  await expect(alert).toContainText("No pudimos abrir «notas.json»: no es un tablero.json del proceso de datos de Conecta-TE");
  // The message takes the focus, so it is seen and read at once.
  await expect(alert).toBeFocused();
  await expect(alert.getByText(/^Detalle para el equipo de datos$/)).toBeVisible();
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from("esto no es JSON") }, alert.getByText(/tablero\.json»: su contenido no es el de un tablero\.json/));
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from('{"contrato": "tabl') }, alert.getByText(/tablero\.json»: está cortado o dañado: parece que la descarga no terminó\. Descárgalo de nuevo\./));
  const broken = JSON.parse(await readFile(FIXTURE, "utf8"));
  broken.uso.rubricas.efectiva.pop();
  await choose(page, { name: "tablero.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(broken)) }, alert.getByText(/tablero\.json»: tiene un error por dentro/));
  await alert.getByText("Detalle para el equipo de datos", { exact: true }).click();
  await expect(alert.getByText(/las columnas de filas y uso no tienen el mismo largo/)).toBeVisible();
  await expect(changeFile(page)).toHaveCount(0);
  await choose(page, FIXTURE, changeFile(page));
  await expect(page.getByRole("heading", { level: 1, name: /^¿A quién invitar al taller de/ })).toBeVisible();
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
  await expect(startHeading(page)).toBeVisible();
  await expect(nav).toHaveCount(0);
  // A mistaken tap goes back to the file that was open.
  await page.getByRole("button", { name: "Volver al tablero con el archivo que ya estaba abierto" }).click();
  await expect(nav.getByRole("button", { name: /^Pronóstico 2026-1/ })).toBeVisible();
  await changeFile(page).click();
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
