# Tablero de adopción · Conecta-TE

Este tablero ayuda a Conecta-TE a decidir a qué profesores invitar a cada taller de las herramientas de Bloque Neón. El punto de partida es la herramienta. Para cada una, el tablero muestra:

- en qué momento está cada profesor con ella (todavía no la usa, empieza, la usa, se apropia o la dejó);
- a qué grupo de uso pertenece;
- qué tan probable es que empiece a usarla la próxima vez que dicte.

Con eso se arma la lista de invitados.

**En este repositorio no hay ningún dato real de profesores.** El tablero no trae datos: los lee del archivo que cada persona abre.

## Cómo se usa

1. Descarga `tablero.json` del proceso de datos de Conecta-TE en Databricks. Sale uno nuevo cada semestre.
2. Abre el tablero: **https://uniandesconectate.github.io/tablero-adopcion/**
3. Arrastra `tablero.json` a la pantalla de inicio o búscalo con «Elegir el archivo». Si el archivo no es el correcto, el tablero lo dice y deja elegir otro.
4. Para abrir otro archivo, usa «Cambiar archivo», arriba a la derecha.

El archivo se lee solo dentro del navegador: no se sube a ningún servidor y no se guarda. Al recargar o cerrar la página, el tablero lo vuelve a pedir. Lo único que el navegador recuerda es la convocatoria que estás armando (los códigos y talleres marcados), para no perderla al recargar.

## Correrlo en un computador

Necesita Node.js 20.9 o posterior. Se probó con Node.js 24.

```sh
npm ci
npm run dev
```

Se abre en **http://127.0.0.1:3011** con la misma pantalla de inicio: abre allí tu `tablero.json`.

## Cómo se publica

Cada cambio que llega a la rama `main` se publica solo. La acción de GitHub `.github/workflows/pages.yml` revisa el código, corre las pruebas, compila el tablero como página estática y la sube a GitHub Pages. Nadie tiene que publicarlo a mano.

## Comprobaciones

```sh
npm run check    # revisión de tipos
npm test         # pruebas de las reglas
npm run test:ui  # pruebas en el navegador (la primera vez: npm run test:install)
```

Las pruebas usan datos de prueba que nunca llegan a la página: `tests/sintetico.ts` (profesores inventados, para las reglas) y `tests/fixtures/tablero-ejemplo.json` (un `tablero.json` pequeño de ejemplo, que las pruebas en el navegador abren desde la pantalla de inicio).

## Cuidados

- Nunca se suben datos de profesores a este repositorio: la carpeta `datos/real/` está en `.gitignore`.
- La compilación no lee ningún archivo de datos, así que la página publicada no puede llevar datos de profesores.

## Archivos principales

| Archivo | Qué hace |
| --- | --- |
| `src/components/start.tsx` | Pantalla de inicio: pide `tablero.json`, lo revisa y abre el tablero |
| `src/components/dashboard.tsx` | Navegación, resumen, herramientas, profesores, fichas y convocatoria |
| `src/components/analytics-pages.tsx` | Grupos y predicciones |
| `src/lib/real.ts` | Revisa `tablero.json` (formato `tablero-adopcion/v2`) y lo prepara para el tablero |
| `src/lib/data.ts` | Guarda en memoria el archivo abierto mientras la pestaña está abierta |
| `src/lib/domain.ts` | Reglas de estados, filtros, resúmenes y exportación |
| `app/globals.css` | Identidad visual y adaptación a celular |
