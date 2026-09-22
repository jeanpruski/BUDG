import { invoke, isTauri } from "@tauri-apps/api/core";
import { AppState, validateState } from "./domain";

// The UI depends only on this contract: a shared backend can replace the local adapters.
export interface BudgetRepository {
  load(): Promise<AppState | null>;
  save(state: AppState, expectedRevision: number): Promise<AppState>;
  backups(): Promise<Backup[]>;
  recover(state: AppState): Promise<AppState>;
}
export type Backup = { id: string; createdAt: string; state: AppState };
const conflict =
  "Les données ont changé dans une autre fenêtre. Rechargez l’application avant de continuer.";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("budg-local-v3", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("state");
      request.result.createObjectStore("backups", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Le stockage local est indisponible. Vérifiez les autorisations de votre navigateur.",
        ),
      );
  });
}
const browserRepository: BudgetRepository = {
  async recover(state) {
    return browserRepository.save(state, -1);
  },
  async load() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readonly");
      const request = tx.objectStore("state").get("current");
      request.onsuccess = () => {
        try {
          resolve(request.result ? validateState(request.result) : null);
        } catch {
          reject(
            new Error(
              "La sauvegarde locale est invalide. Restaurez une sauvegarde depuis l’écran de récupération.",
            ),
          );
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  },
  async save(state, expectedRevision) {
    const next = validateState({
      ...state,
      revision: expectedRevision < 0 ? 1 : expectedRevision + 1,
    });
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["state", "backups"], "readwrite");
      let reason =
        "La sauvegarde a échoué. Votre modification n’a pas été enregistrée.";
      const states = tx.objectStore("state");
      const request = states.get("current");
      request.onsuccess = () => {
        const current = request.result;
        if (
          expectedRevision >= 0 &&
          (current?.revision ?? 0) !== expectedRevision
        ) {
          reason = conflict;
          tx.abort();
          return;
        }
        if (expectedRevision < 0)
          next.revision =
            Number.isSafeInteger(current?.revision) && current.revision >= 0
              ? current.revision + 1
              : 1;
        if (current) {
          const backups = tx.objectStore("backups");
          const id = `${new Date().toISOString()}-${crypto.randomUUID()}`;
          backups.put({
            id,
            createdAt: new Date().toISOString(),
            state: current,
          });
          const keys = backups.getAllKeys();
          keys.onsuccess = () =>
            keys.result
              .slice(0, Math.max(0, keys.result.length - 20))
              .forEach((key) => backups.delete(key));
        }
        states.put(next, "current");
      };
      tx.oncomplete = () => {
        db.close();
        resolve(next);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(new Error(reason));
      };
    });
  },
  async backups() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("backups", "readonly");
      const request = tx.objectStore("backups").getAll();
      request.onsuccess = () =>
        resolve(
          (request.result as Backup[])
            .filter((copy) => {
              try {
                validateState(copy.state);
                return true;
              } catch {
                return false;
              }
            })
            .sort((a, b) => b.id.localeCompare(a.id)),
        );
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
    });
  },
};
const desktopRepository: BudgetRepository = {
  async recover(state) {
    return desktopRepository.save(state, -1);
  },
  async load() {
    const raw = await invoke<unknown>("load_budget");
    return raw ? validateState(raw) : null;
  },
  async save(state, expectedRevision) {
    const next = validateState({ ...state, revision: expectedRevision + 1 });
    return validateState(
      await invoke("save_budget", {
        state: next,
        expectedRevision,
        createdAt: new Date().toISOString(),
      }),
    );
  },
  async backups() {
    return (await invoke<Backup[]>("list_backups")).filter((copy) => {
      try {
        validateState(copy.state);
        return true;
      } catch {
        return false;
      }
    });
  },
};
export const repository = isTauri() ? desktopRepository : browserRepository;
export const storageLabel = isTauri()
  ? "Fichier local sur cet ordinateur"
  : "Stockage local de ce navigateur";
export function exportBackup(state: AppState) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `BUDG-${state.budget.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
