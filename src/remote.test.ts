import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState } from "./store";
import { ApiError, BACKUP_WARNING_EVENT, SESSION_EXPIRED_EVENT, clearSessionToken, getSession, login, logout, remoteRepository } from "./remote";

const editor = { id: "user-1", email: "jean@example.com", displayName: "Jean", role: "editor" };
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
const fetchMock = vi.fn();
beforeEach(() => {
  clearSessionToken();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); clearSessionToken(); });

describe("stockage serveur authentifié", () => {
  it("transmet le cookie et le CSRF de session, puis conserve la révision canonique du serveur", async () => {
    const before = initialState();
    const saved = { ...before, revision: 1 };
    fetchMock.mockResolvedValueOnce(response({ user: editor, csrfToken: "csrf-123" }));
    expect(await getSession()).toEqual(editor);
    fetchMock.mockResolvedValueOnce(response({ state: saved }));
    expect(await remoteRepository.save(before, 0)).toEqual(saved);
    const [path, init] = fetchMock.mock.calls[1];
    expect(path).toBe("/api/budget");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.headers.get("X-CSRF-Token")).toBe("csrf-123");
    expect(JSON.parse(init.body)).toEqual({ state: before, expectedRevision: 0 });
  });
  it("confirme le budget malgré une archive en attente et efface l’alerte au prochain enregistrement sans avertissement", async () => {
    const target = new EventTarget();
    const warnings: string[][] = [];
    target.addEventListener(BACKUP_WARNING_EVENT, (event) => {
      warnings.push((event as CustomEvent<string[]>).detail);
    });
    vi.stubGlobal("window", target);
    fetchMock.mockResolvedValueOnce(response({ user: editor, csrfToken: "csrf-123" }));
    await getSession();
    const first = { ...initialState(), revision: 1 };
    const warning = "L’archive mensuelle attend sa publication. Une nouvelle tentative est programmée.";
    fetchMock.mockResolvedValueOnce(response({ state: first, warnings: [warning] }));
    await expect(remoteRepository.save(initialState(), 0)).resolves.toEqual(first);
    expect(warnings).toEqual([[warning]]);
    const second = { ...first, revision: 2 };
    fetchMock.mockResolvedValueOnce(response({ state: second }));
    await expect(remoteRepository.save(first, 1)).resolves.toEqual(second);
    expect(warnings).toEqual([[warning], []]);
    fetchMock.mockResolvedValueOnce(response({ state: { ...second, revision: 3 }, warnings: [] }));
    await remoteRepository.save(second, 2);
    expect(warnings.at(-1)).toEqual([]);
  });
  it("n’annonce pas un échec financier lorsque seules les métadonnées d’archive sont invalides", async () => {
    const target = new EventTarget();
    const warned = vi.fn();
    target.addEventListener(BACKUP_WARNING_EVENT, warned);
    vi.stubGlobal("window", target);
    fetchMock.mockResolvedValueOnce(response({ user: editor, csrfToken: "csrf-123" }));
    await getSession();
    const saved = { ...initialState(), revision: 1 };
    fetchMock.mockResolvedValueOnce(response({ state: saved, warnings: "unexpected" }));
    await expect(remoteRepository.save(initialState(), 0)).resolves.toEqual(saved);
    expect(warned).toHaveBeenCalledOnce();
    expect((warned.mock.calls[0][0] as CustomEvent<string[]>).detail[0]).toMatch(/archive mensuelle/);
  });
  it("ignore une alerte arrivée après la fermeture de sa session", async () => {
    const target = new EventTarget();
    const warned = vi.fn();
    target.addEventListener(BACKUP_WARNING_EVENT, warned);
    vi.stubGlobal("window", target);
    fetchMock.mockResolvedValueOnce(response({ user: editor, csrfToken: "csrf-123" }));
    await getSession();
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    const saving = remoteRepository.save(initialState(), 0);
    clearSessionToken();
    const saved = { ...initialState(), revision: 1 };
    finish(response({ state: saved, warnings: ["Archive en attente."] }));
    await expect(saving).resolves.toEqual(saved);
    expect(warned).not.toHaveBeenCalled();
  });
  it("refuse toute écriture sans session CSRF et toute restauration sans contrôle de révision", async () => {
    await expect(remoteRepository.save(initialState(), 0)).rejects.toThrow(/session/);
    await expect(remoteRepository.recover(initialState())).rejects.toThrow(/révision/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("distingue un budget absent d’une réponse corrompue sans substituer de données locales", async () => {
    fetchMock.mockResolvedValueOnce(response({ state: null }));
    expect(await remoteRepository.load()).toBeNull();
    fetchMock.mockResolvedValueOnce(response({ budget: null }));
    await expect(remoteRepository.load()).rejects.toThrow(/budget valide/);
    fetchMock.mockResolvedValueOnce(response({ state: {} }));
    await expect(remoteRepository.load()).rejects.toThrow(/invalide/);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(remoteRepository.load()).rejects.toThrow(/inaccessible/);
  });
  it("propage les conflits et permissions refusées au lieu de modifier le stockage local", async () => {
    fetchMock.mockResolvedValueOnce(response({ user: editor, csrfToken: "csrf-123" }));
    await getSession();
    fetchMock.mockResolvedValueOnce(response({ error: "Ce budget a changé." }, 409));
    await expect(remoteRepository.save(initialState(), 0)).rejects.toMatchObject({ status: 409, message: "Ce budget a changé." });
    fetchMock.mockResolvedValueOnce(response({ error: "Lecture seule." }, 403));
    await expect(remoteRepository.save(initialState(), 0)).rejects.toMatchObject({ status: 403, message: "Lecture seule." });
  });
  it("efface la session et prévient l’interface dès un 401", async () => {
    const target = new EventTarget();
    const expired = vi.fn();
    target.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal("window", target);
    fetchMock.mockResolvedValueOnce(response({ user: editor, csrfToken: "csrf-123" }));
    await getSession();
    fetchMock.mockResolvedValueOnce(response({ error: "Session expirée." }, 401));
    await expect(remoteRepository.load()).rejects.toBeInstanceOf(ApiError);
    expect(expired).toHaveBeenCalledOnce();
    await expect(remoteRepository.save(initialState(), 0)).rejects.toThrow(/session/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("ouvre une session de lecture puis envoie le CSRF pour la déconnexion", async () => {
    const viewer = { ...editor, role: "viewer" };
    fetchMock.mockResolvedValueOnce(response({ user: viewer, csrfToken: "csrf-viewer" }));
    expect(await login("jean@example.com", "mot-de-passe")).toEqual(viewer);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "jean@example.com", password: "mot-de-passe" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await logout();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/logout");
    expect(fetchMock.mock.calls[1][1].headers.get("X-CSRF-Token")).toBe("csrf-viewer");
    await expect(remoteRepository.save(initialState(), 0)).rejects.toThrow(/session/);
  });
  it("valide toutes les copies du serveur avant de les proposer", async () => {
    const copy = { id: "copy-1", createdAt: "2026-10-27T12:00:00Z", state: initialState() };
    fetchMock.mockResolvedValueOnce(response({ backups: [copy] }));
    expect(await remoteRepository.backups()).toEqual([copy]);
    fetchMock.mockResolvedValueOnce(response({ backups: [{ ...copy, state: {} }] }));
    await expect(remoteRepository.backups()).rejects.toThrow();
  });
});
