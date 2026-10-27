import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
for (const script of ["build", "build:server"]) {
  const result = spawnSync(npm, ["run", script], {
    stdio: "inherit",
    env: { ...process.env, VITE_STORAGE_MODE: "server" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync("dist/budg-runtime.json", JSON.stringify({ storage: "server" }) + "\n");
