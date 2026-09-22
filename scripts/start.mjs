import { createServer } from "vite";
import { spawn } from "node:child_process";

const address = "http://127.0.0.1:1420";
const shouldOpen = process.env.BUDG_NO_OPEN !== "1";
const server = await createServer({
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    open: shouldOpen ? address : false,
  },
});
try {
  await server.listen();
  console.log(`\nBUDG est ouvert sur cet ordinateur : ${address}`);
  console.log(
    "Gardez cette fenêtre ouverte pendant l’utilisation. Ctrl+C pour arrêter.\n",
  );
} catch (error) {
  await server.close();
  let alreadyRunning = false;
  try {
    const response = await fetch(address, {
      signal: AbortSignal.timeout(2000),
    });
    alreadyRunning =
      response.ok && (await response.text()).includes("<title>BUDG</title>");
  } catch {
    /* Report the original startup error below. */
  }
  if (alreadyRunning) {
    console.log(`BUDG fonctionne déjà : ${address}`);
    if (shouldOpen && process.platform === "darwin") {
      const browser = spawn("open", [address], {
        stdio: "ignore",
        detached: true,
      });
      browser.on("error", () =>
        console.log(`Ouvrez ${address} dans votre navigateur.`),
      );
      browser.unref();
    }
  } else {
    console.error("Impossible de démarrer BUDG :", error.message);
    process.exitCode = 1;
  }
}
