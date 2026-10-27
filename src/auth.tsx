import { FormEvent, ReactNode, useEffect, useState } from "react";
import { LockKeyhole, LogOut } from "lucide-react";
import { ApiError, RemoteUser, SESSION_EXPIRED_EVENT, clearSessionToken, getSession, login, logout } from "./remote";
import { LoadingScreen, Spinner } from "./visuals";
import "./auth.css";

function message(error: unknown) {
  return error instanceof Error && error.name !== "ZodError"
    ? error.message
    : "La réponse d’authentification du serveur est invalide. Réessayez.";
}
export function AuthenticationGate({ children }: {
  children: (user: RemoteUser, signOut: () => void) => ReactNode;
}) {
  const [user, setUser] = useState<RemoteUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    getSession().then((next) => {
      if (active) { setUser(next); setError(""); }
    }).catch((e) => {
      if (active) {
        setUser(null);
        setError(message(e));
        setFailed(!(e instanceof ApiError && e.status === 401));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => {
    const expired = () => {
      clearSessionToken();
      setUser(null);
      setError("Votre session a expiré. Reconnectez-vous.");
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, []);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      setUser(await login(String(data.get("email")).trim(), String(data.get("password"))));
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setUser(null);
    setError("");
    setBusy(true);
    try { await logout(); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  if (loading) return <LoadingScreen />;
  if (user) return children(user, () => { void signOut(); });
  return (
    <main className="auth-stage">
      <section className="panel auth-card">
        <div className="auth-brand"><img src="/assets/budg-logo.png" alt="" width="48" height="48" /><strong>BUDG</strong></div>
        {error && <p className="alert error" role="alert">{error}</p>}
        {failed ? <button className="primary full" onClick={() => setAttempt((n) => n + 1)}>Réessayer</button> : (
          <form onSubmit={(e) => { void signIn(e); }}>
            <fieldset disabled={busy}>
              <label className="field">Adresse e-mail<input name="email" type="email" autoComplete="username" required autoFocus /></label>
              <label className="field">Mot de passe<input name="password" type="password" autoComplete="current-password" required /></label>
              <button className="primary full" type="submit">{busy && <Spinner />}{busy ? "Connexion…" : "Se connecter"}</button>
            </fieldset>
          </form>
        )}
      </section>
    </main>
  );
}
export function SessionControls({ user, signOut }: { user: RemoteUser; signOut: () => void }) {
  return <div className="session-controls"><span><strong>{user.displayName || user.email}</strong><small>{user.role === "editor" ? "Modification autorisée" : "Lecture seule"}</small></span><button type="button" className="secondary" onClick={signOut}><LogOut size={15} /> Déconnexion</button></div>;
}
