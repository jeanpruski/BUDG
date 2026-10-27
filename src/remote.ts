import { z } from "zod";
import { AppState, validateState } from "./domain";
import type { Backup, BudgetRepository } from "./repository";

export const serverStorageMode =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_STORAGE_MODE === "server";
export const SESSION_EXPIRED_EVENT = "budg:session-expired";
export const BACKUP_WARNING_EVENT = "budg:backup-warning";
const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string(),
  role: z.enum(["editor", "viewer"]),
});
const sessionSchema = z.object({
  user: userSchema.nullable(),
  csrfToken: z.string().min(1).optional(),
});
export type RemoteUser = z.infer<typeof userSchema>;
let csrfToken: string | null = null;
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}
export function clearSessionToken() {
  csrfToken = null;
}
export async function apiRequest(path: string, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (method !== "GET" && method !== "HEAD") {
    if (!csrfToken)
      throw new ApiError(
        "Votre session est incomplète. Reconnectez-vous avant de continuer.",
        403,
      );
    headers.set("X-CSRF-Token", csrfToken);
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Le serveur est inaccessible. Vérifiez votre connexion et réessayez.",
    );
  }
  if (response.status === 401) {
    clearSessionToken();
    if (typeof window !== "undefined")
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }
  if (response.status === 204) return null;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError("Le serveur a renvoyé une réponse illisible.", response.status);
  }
  if (!response.ok) {
    const serverMessage =
      typeof data === "object" && data !== null && "error" in data &&
      typeof data.error === "string"
        ? data.error
        : typeof data === "object" && data !== null && "message" in data &&
            typeof data.message === "string"
          ? data.message
          : null;
    const fallback = response.status === 401
      ? "Votre session a expiré. Reconnectez-vous."
      : response.status === 403
        ? "Votre compte ne permet pas cette modification."
        : response.status === 409
          ? "Le budget a changé depuis son ouverture. Rechargez-le avant de continuer."
          : "Le serveur n’a pas pu effectuer cette opération. Réessayez.";
    throw new ApiError(serverMessage ?? fallback, response.status);
  }
  return data;
}
export async function getSession() {
  const session = sessionSchema.parse(await apiRequest("/api/session"));
  csrfToken = session.csrfToken ?? null;
  return session.user;
}
export async function login(email: string, password: string) {
  // Login starts a session and therefore has no prior CSRF token.
  const response = await fetch("/api/login", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).catch(() => {
    throw new Error("Le serveur est inaccessible. Vérifiez votre connexion et réessayez.");
  });
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new Error("Le serveur a renvoyé une réponse illisible."); }
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && "error" in data &&
      typeof data.error === "string" ? data.error : "Connexion impossible. Vérifiez votre adresse e-mail et votre mot de passe.";
    throw new ApiError(message, response.status);
  }
  const session = sessionSchema.parse(data);
  if (!session.user || !session.csrfToken)
    throw new Error("Le serveur n’a pas ouvert de session valide. Réessayez.");
  csrfToken = session.csrfToken;
  return session.user;
}
export async function logout() {
  try { await apiRequest("/api/logout", { method: "POST" }); }
  finally { clearSessionToken(); }
}
function readBudget(data: unknown): AppState | null {
  if (typeof data !== "object" || data === null || !("state" in data))
    throw new Error("La réponse du serveur ne contient pas de budget valide.");
  if (data.state === null) return null;
  try { return validateState(data.state); }
  catch { throw new Error("Le budget du serveur est invalide. Les données n’ont pas été remplacées."); }
}
export const remoteRepository: BudgetRepository = {
  async load() { return readBudget(await apiRequest("/api/budget")); },
  async save(state, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error("La révision du budget est invalide. Rechargez l’application.");
    const sessionToken = csrfToken;
    const data = await apiRequest("/api/budget", {
      method: "PUT",
      body: JSON.stringify({ state: validateState(state), expectedRevision }),
    });
    const saved = readBudget(data);
    if (!saved) throw new Error("Le serveur n’a pas enregistré le budget.");
    const warningResult = z.object({ warnings: z.array(z.string().trim().min(1)).optional() }).safeParse(data);
    // A confirmed budget save must remain successful even if optional archive metadata is malformed.
    const warnings = warningResult.success ? warningResult.data.warnings ?? [] : [
      "L’état de publication de l’archive mensuelle n’a pas pu être confirmé. Vérifiez sa sauvegarde.",
    ];
    // A late response from a closed session must not affect a newly connected account.
    if (typeof window !== "undefined" && sessionToken !== null && sessionToken === csrfToken)
      window.dispatchEvent(new CustomEvent<string[]>(BACKUP_WARNING_EVENT, { detail: warnings }));
    return saved;
  },
  async backups() {
    const data = await apiRequest("/api/backups");
    if (typeof data !== "object" || data === null || !("backups" in data) || !Array.isArray(data.backups))
      throw new Error("La liste des sauvegardes du serveur est invalide.");
    return data.backups.map((copy: unknown): Backup => {
      const parsed = z.object({ id: z.string(), createdAt: z.string(), state: z.unknown() }).parse(copy);
      return { ...parsed, state: validateState(parsed.state) };
    });
  },
  async recover() {
    throw new Error("Une restauration serveur nécessite un budget chargé et une révision vérifiée.");
  },
};
