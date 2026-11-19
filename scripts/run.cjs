// Keep local commands usable when a shell still selects an older Node installation.
const { execFileSync, spawn } = require("node:child_process");
const { dirname, delimiter, join } = require("node:path");
const candidates = [process.env.CONECTATE_NODE, process.execPath, "/opt/homebrew/bin/node", "/usr/local/bin/node", "node"].filter(Boolean);
let runtime;
for (const candidate of [...new Set(candidates)]) {
  try {
    const result = JSON.parse(execFileSync(candidate, ["-p", "JSON.stringify({version:process.versions.node,path:process.execPath})"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const [major, minor] = result.version.split(".").map(Number);
    if (major > 20 || major === 20 && minor >= 9) { runtime = result.path; break; }
  } catch { /* Try the next available installation. */ }
}
if (!runtime) {
  process.stderr.write("Este prototipo necesita Node.js 20.9 o posterior. Activa Node 24 con tu gestor de versiones y vuelve a ejecutar el comando.\n");
  process.exit(1);
}
const commands = {
  dev: ["next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3011"],
  build: ["next/dist/bin/next", "build"],
  start: ["next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3011"],
  check: ["typescript/bin/tsc", "--noEmit"],
  test: ["tsx/dist/cli.mjs", "--test", "tests/domain.test.ts", "tests/real.test.ts"],
  "test:ui": ["@playwright/test/cli.js", "test"],
  browsers: ["playwright/cli.js", "install", "chromium"],
};
const command = commands[process.argv[2]];
if (!command) { process.stderr.write("Comando desconocido.\n"); process.exit(1); }
const child = spawn(runtime, [join(__dirname, "..", "node_modules", command[0]), ...command.slice(1), ...process.argv.slice(3)], {
  stdio: "inherit",
  env: { ...process.env, PATH: `${dirname(runtime)}${delimiter}${process.env.PATH || ""}`, PLAYWRIGHT_SKIP_BROWSER_GC: process.env.PLAYWRIGHT_SKIP_BROWSER_GC || "1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => { process.stderr.write(`${error.message}\n`); process.exit(1); });
child.on("exit", code => process.exit(code === null ? 1 : code));
