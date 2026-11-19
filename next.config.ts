import type { NextConfig } from "next";

// Publishing as a static page (GitHub Pages) sets PAGES_BASE_PATH. No build carries data: each person opens tablero.json in the browser.
const pages = process.env.PAGES_BASE_PATH;

const config: NextConfig = {
  ...(pages !== undefined ? { output: "export" as const, basePath: pages } : {}),
  devIndicators: false,
};
export default config;
