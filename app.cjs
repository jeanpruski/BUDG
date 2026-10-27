// Point d’entrée compatible avec le chargement du programme par Passenger/N0C.
const { startServer } = require("./server-dist/index.cjs");

startServer().catch(() => {
  console.error("BUDG : démarrage impossible. Vérifiez la configuration et les migrations.");
  process.exitCode = 1;
});
