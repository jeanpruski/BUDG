import { build } from "esbuild";

await build({
  entryPoints: ["server/index.ts", "server/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  outdir: "server-dist",
  outExtension: { ".js": ".cjs" },
  loader: { ".sql": "text" },
  logLevel: "info",
});
