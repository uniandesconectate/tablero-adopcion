import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

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
  await page.goto("/");
  const aggregate = page.getByRole("button", { name: /^Rúbricas: \d+ de \d+ en Adopta\. Ver profesores$/ });
  await expect(aggregate).toBeVisible();
  const label = await aggregate.getAttribute("aria-label");
  const count = Number(label!.match(/Rúbricas: (\d+)/)![1]);
  expect(count).toBeGreaterThan(0);
  await aggregate.click();
  await expect(page.getByRole("heading", { name: "El acompañamiento tiene nombre." })).toBeVisible();
  await expect(page.getByLabel("Herramienta", { exact: true })).toHaveValue("rubricas");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Adopta");
  await expect(page.getByRole("heading", { name: new RegExp(`^${count} profesores`) })).toBeVisible();
  const states = await page.locator("table tbody .state-badge").allTextContents();
  expect(states.length).toBeGreaterThan(0);
  expect(states.every(state => state === "Adopta")).toBe(true);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: /Cada profesor/ })).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Adopta");
  await expect(page.getByLabel("Herramienta", { exact: true })).toHaveValue("rubricas");
});

test("la convocatoria conserva personas fuera de los filtros y después de recargar", async ({ page }) => {
  await page.goto("/?vista=profesores");
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toBeVisible();
  const names = [await professorNameAt(page, 0), await professorNameAt(page, 1)];
  for (const name of names) await page.getByRole("checkbox", { name: `Seleccionar a ${name}`, exact: true }).check();
  await expect(page.getByRole("banner").getByRole("button", { name: "Convocatoria (2)", exact: true })).toBeVisible();
  await page.getByLabel("Buscar profesor", { exact: true }).fill("ninguna-persona-coincide-98231");
  await expect(page.getByRole("heading", { name: "No hay profesores con estos criterios" })).toBeVisible();
  await expect(page.getByText("0 se ven en esta lista · 2 no se ven con los filtros actuales (siguen guardados)", { exact: true })).toBeVisible();

  await page.reload();
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
  await page.goto("/?vista=profesores&herramienta=rubricas");
  await expect(page.getByLabel("Buscar profesor", { exact: true })).toBeVisible();
  const name = await professorNameAt(page, 0);
  await page.getByRole("button", { name: `Ver ficha de ${name}`, exact: true }).click();
  const detail = page.getByRole("dialog", { name, exact: true });
  await expect(detail.getByLabel("Herramienta de la ficha", { exact: true })).toHaveValue("rubricas");
  await detail.getByRole("button", { name: /^Agregar a la convocatoria del taller «/ }).click();
  await expect(detail.getByRole("button", { name: /^Quitar de la convocatoria del taller «/ })).toBeVisible();
  await detail.getByLabel("Herramienta de la ficha", { exact: true }).selectOption("contenidos");
  await detail.getByRole("button", { name: /^Agregar a la convocatoria del taller «/ }).click();
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
  expect(download.suggestedFilename()).toMatch(/^convocatoria-conectate-demo-\d{4}-[12]\.csv$/);
  const csv = await readFile((await download.path())!, "utf8");
  const lines = csv.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("Profesor");
  expect(lines[1]).toContain(name);
  expect(lines[1]).toContain("Contenidos | Rúbricas");
  expect(lines[1]).toContain("Datos sintéticos");
});

test("una búsqueda sin coincidencias permite restablecer la lista", async ({ page }) => {
  await page.goto("/?vista=profesores");
  const search = page.getByLabel("Buscar profesor", { exact: true });
  await search.fill("persona-inexistente-67258");
  await expect(page.getByRole("heading", { name: "No hay profesores con estos criterios" })).toBeVisible();
  await page.getByRole("button", { name: "Limpiar filtros de la lista", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(page.getByLabel("Estado en Rúbricas (2025-2)", { exact: true })).toHaveValue("Todos");
  await expect(page.locator("table tbody tr").first()).toBeVisible();
});

test("la validación aclara su objetivo y conserva la evaluación global al cambiar facultad", async ({ page }) => {
  await page.goto("/");
  await navigate(page, "Grupos parecidos");
  await page.getByRole("button", { name: /profesores clasificados en Adopta;.*Ver grupo\./ }).first().click();
  const facultySelect = page.getByLabel("Facultad", { exact: true });
  const faculty = await facultySelect.locator("option").nth(1).getAttribute("value");
  // An option without an explicit value uses its visible text as the value.
  const facultyValue = faculty ?? await facultySelect.locator("option").nth(1).innerText();
  await facultySelect.selectOption(facultyValue);
  await navigate(page, "Pronóstico");
  await page.getByRole("combobox", { name: "Herramienta", exact: true }).selectOption("debates");
  await expect(page.getByText("Probabilidad de que configure Debates la próxima vez que dicte, calculada con los datos de 2025-2.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "¿Qué tan bien acierta?", exact: true }).click();
  await expect(page.getByText("Revisión de Debates con datos sintéticos de todas las facultades y grupos.", { exact: true })).toBeVisible();
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
  await page.goto("/");
  const views = [
    ["Resumen", /Cada profesor/],
    ["Talleres y herramientas", /El uso tiene distintos momentos/],
    ["Elegir profesores", /El acompañamiento tiene nombre/],
    ["Grupos parecidos", /Distintas formas de usar la plataforma/],
    ["Pronóstico", /Qué podría pasar, con qué respaldo/],
  ] as const;
  for (const [label, heading] of views) {
    await navigate(page, label);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir menú", exact: true })).toHaveAttribute("aria-expanded", "false");
    await assertNoBodyOverflow(page);
  }
  await page.getByRole("button", { name: "Guía: el pronóstico", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Guía del tablero" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await navigate(page, "Elegir profesores");
  const name = await professorNameAt(page, 0);
  await page.getByRole("button", { name: `Ver ficha de ${name}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name, exact: true })).toBeVisible();
  await assertNoBodyOverflow(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
