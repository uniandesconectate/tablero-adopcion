# Tablero de adopción · Conecta-TE

Este tablero ayuda a Conecta-TE a decidir a qué profesores invitar a cada taller de las herramientas de Bloque Neón. El punto de partida es la herramienta. Para cada una, el tablero muestra:

- en qué momento está cada profesor con ella (todavía no la usa, empieza, la usa, se apropia o la dejó);
- a qué grupo de uso pertenece;
- qué tan probable es que empiece a usarla la próxima vez que dicte.

Con eso se arma la lista de invitados.

**En este repositorio no hay ningún dato de profesores.** La página publicada muestra datos de demostración, inventados para probar el recorrido.

## Ver el tablero

Está publicado en GitHub Pages: **https://uniandesconectate.github.io/tablero-adopcion/**

Los datos reales salen cada semestre del proceso de datos de Conecta-TE en Databricks, como un archivo `tablero.json`. Quien tenga acceso descarga ese archivo y lo abre en el tablero desde el botón «Cargar datos». El archivo se lee solo dentro del navegador: no se sube a ningún servidor y desaparece al cerrar la página. El botón «Cargar datos» es el siguiente paso del proyecto; mientras tanto, la página muestra los datos de demostración.

## Correrlo en un computador

Necesita Node.js 20.9 o posterior. Se probó con Node.js 24.

```sh
npm ci
npm run dev
```

Se abre en **http://127.0.0.1:3011**.

## Cómo se publica

Cada cambio que llega a la rama `main` se publica solo. La acción de GitHub `.github/workflows/pages.yml` revisa el código, corre las pruebas, compila el tablero como página estática y la sube a GitHub Pages. Nadie tiene que publicarlo a mano.

## Comprobaciones

```sh
npm run check    # revisión de tipos
npm test         # pruebas de las reglas
npm run test:ui  # pruebas en el navegador (la primera vez: npm run test:install)
```

## Cuidados

- Nunca se suben datos de profesores a este repositorio: la carpeta `datos/real/` está en `.gitignore`.
- Si alguien intenta publicar la página con datos reales, la compilación se detiene con un error.

## Archivos principales

| Archivo | Qué hace |
| --- | --- |
| `src/components/dashboard.tsx` | Navegación, resumen, herramientas, profesores, fichas y convocatoria |
| `src/components/analytics-pages.tsx` | Grupos y predicciones |
| `src/lib/real.ts` | Lee y revisa el archivo de datos reales (formato `tablero-adopcion/v2`) |
| `src/lib/sintetico.ts` | Datos de demostración |
| `src/lib/domain.ts` | Reglas de estados, filtros, resúmenes y exportación |
| `app/globals.css` | Identidad visual y adaptación a celular |
