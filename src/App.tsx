import { MobileMenu } from "./MobileMenu";
import { EnvelopeSuggestions } from "./suggestions";
import { BudgetGuide, EnvelopeCoach } from "./guide";
import { HeroArt, LoadingScreen, Spinner, Toast } from "./visuals";
import {
  HouseholdForm,
  MonthlyIncomeForm,
  LineForm,
  ExpenseForm,
  PaymentForm,
} from "./forms";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  LockKeyhole,
  Sparkles,
  CheckCircle2,
  Download,
  History as HistoryIcon,
  Home,
  Plus,
  Receipt,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";
import {
  AppState,
  BudgetLine,
  Expense,
  Payment,
  PotExpense,
  potSummary,
  budgetSummary,
  euro,
  monthLabel,
  parseMoney,
  today,
  validateState,
} from "./domain";
import {
  closeMonth,
  configureHousehold,
  initialState,
  savePotExpense,
  removePotExpense,
  removeExpense,
  removeLine,
  removePayment,
  resetState,
  resetEverything,
  saveExpense,
  saveLine,
  savePayment,
  setSettled,
  confirmMonthlyIncomes,
  uid,
} from "./store";
import { Backup, exportBackup, repository, storageLabel } from "./repository";
import {
  Actions,
  Dashboard,
  Envelopes,
  History,
  Members,
  CommonPot,
  Transactions,
} from "./screens";
import { Field, Form, Metric, Modal } from "./ui";

type View =
  | "dashboard"
  | "budget"
  | "expenses"
  | "payments"
  | "pot"
  | "history"
  | "settings";
type Dialog =
  | { type: "line"; line?: BudgetLine; template?: BudgetLine }
  | { type: "expense"; lineId?: string; expense?: Expense }
  | { type: "payment"; memberId?: string; payment?: Payment }
  | { type: "close" }
  | { type: "monthlyIncome" }
  | { type: "coach" }
  | { type: "potExpense"; expense?: PotExpense }
  | {
      type: "confirm";
      title: string;
      message: string;
      action: (s: AppState) => AppState;
    };
const navigation = [
  ["dashboard", "Vue d’ensemble", Home],
  ["budget", "Enveloppes", WalletCards],
  ["expenses", "Dépenses", Receipt],
  ["payments", "Versements", Users],
  ["pot", "Pot commun", ArrowRight],
  ["history", "Historique", HistoryIcon],
  ["settings", "Paramètres", Settings],
] as const;
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.name === "ZodError"
      ? "Certaines données sont invalides. Vérifiez les montants, les dates et les champs obligatoires."
      : error.message
    : String(error);

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const current = useRef<AppState | null>(null),
    locked = useRef(false);
  const [view, setView] = useState<View>("dashboard"),
    [dialog, setDialog] = useState<Dialog | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [loadingTask, setLoadingTask] = useState<"import" | "backups" | null>(
    null,
  );
  const [backups, setBackups] = useState<Backup[]>([]);
  useEffect(() => {
    let active = true;
    repository
      .load()
      .then((saved) => {
        if (active) {
          const s = saved ?? initialState();
          current.current = s;
          setState(s);
        }
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function commit(
    change: (s: AppState) => AppState,
    message = "Modification enregistrée",
  ) {
    if (locked.current || !current.current) return false;
    locked.current = true;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const previous = current.current;
      const next = await repository.save(change(previous), previous.revision);
      current.current = next;
      setState(next);
      if (!next.configured) {
        setView("dashboard");
        setBackups([]);
      }
      setNotice(message);
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function submit(change: (s: AppState) => AppState, message?: string) {
    const ok = await commit(change, message);
    if (ok) setDialog(null);
    return ok;
  }
  function attempt(action: () => void) {
    try {
      action();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function open(next: Dialog) {
    setError("");
    setDialog(next);
  }
  function confirm(
    title: string,
    message: string,
    action: (s: AppState) => AppState,
  ) {
    open({ type: "confirm", title, message, action });
  }
  function go(next: View) {
    setView(next);
    setNotice("");
    setError("");
  }
  const actions: Actions = {
    line: (line) => open({ type: "line", line }),
    expense: (lineId, expense) => open({ type: "expense", lineId, expense }),
    payment: (memberId, payment) =>
      open({ type: "payment", memberId, payment }),
    removeLine: (id) =>
      confirm(
        "Supprimer cette enveloppe ?",
        "Seules les enveloppes sans dépenses et sans réserve reportée peuvent être supprimées.",
        (s) => removeLine(s, id),
      ),
    removeExpense: (id) =>
      confirm(
        "Supprimer cette dépense ?",
        "Le montant sera rendu disponible dans l’enveloppe. Une facture sera à nouveau marquée comme restant à régler.",
        (s) => removeExpense(s, id),
      ),
    removePayment: (id) =>
      confirm(
        "Supprimer ce versement ?",
        "Le solde du compte et les contributions seront recalculés.",
        (s) => removePayment(s, id),
      ),
    settle: (id, settled) =>
      confirm(
        settled
          ? "Confirmer la facture réglée ?"
          : "Remettre cette facture à régler ?",
        settled
          ? "Confirmez qu’aucun paiement supplémentaire n’est attendu pour cette facture ce mois-ci. Cette action n’ajoute aucune dépense."
          : "Cette facture devra être confirmée à nouveau avant la clôture.",
        (s) => setSettled(s, id, settled),
      ),
    close: () => open({ type: "close" }),
    next: () => open({ type: "monthlyIncome" }),
    potExpense: (expense) => open({ type: "potExpense", expense }),
    removePotExpense: (id) =>
      confirm(
        "Supprimer cette dépense du pot commun ?",
        "Le montant redeviendra disponible dans le pot commun. Aucun mouvement bancaire n’est effectué.",
        (s) => removePotExpense(s, id),
      ),
  };
  async function readImport(file?: File) {
    if (!file || loadingTask) return;
    setLoadingTask("import");
    try {
      if (file.size > 10_000_000)
        throw new Error("Le fichier est trop volumineux (10 Mo maximum).");
      const restored = validateState(JSON.parse(await file.text()));
      confirm(
        "Restaurer cette sauvegarde ?",
        `Elle contient ${restored.budget.label}, ${restored.archivedBudgets.length} mois archivé(s) et remplacera les données actuelles. Une copie automatique des données actuelles sera conservée.`,
        (s) => ({ ...restored, revision: s.revision }),
      );
    } catch (e) {
      setError(`Import impossible. ${errorMessage(e)}`);
    } finally {
      setLoadingTask(null);
    }
  }
  async function listBackups() {
    if (loadingTask) return;
    setLoadingTask("backups");
    try {
      setBackups(await repository.backups());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingTask(null);
    }
  }
  if (loading) return <LoadingScreen />;
  if (!state) return <Recovery error={error} />;
  const b = state.budget,
    summary = budgetSummary(b);
  const closeDialog = () => {
    if (!busy) {
      setDialog(null);
      setError("");
    }
  };
  const activeDialogError = error ? (
    <p className="alert error" role="alert">
      {error}
    </p>
  ) : null;
  return (
    <div className="app-shell">
      <MobileMenu home={() => go("dashboard")}>
        {(close) =>
          navigation.map(([id, title, Icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => {
                go(id);
                close();
              }}
            >
              <Icon size={20} />
              <span>{title}</span>
            </button>
          ))
        }
      </MobileMenu>
      <aside>
        <a
          className="logo"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("dashboard");
          }}
        >
          <span className="brand-symbol">
            <img src="/assets/budg-logo.png" alt="" />
          </span>
          <b>BUDG</b>
        </a>
        <p className="sidebar-caption">À deux, simplement.</p>
        <span className="nav-eyebrow">VOTRE ESPACE</span>
        <nav aria-label="Navigation principale">
          {navigation.map(([id, title, Icon]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              aria-current={view === id ? "page" : undefined}
              onClick={() => go(id)}
            >
              <Icon size={19} />
              <span>{title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="sidebar-note-line" />
        </div>
        <div className="sidebar-footer">
          <span className="privacy-label">
            <LockKeyhole size={12} />
            Local · vos données restent ici
          </span>
          <small>{state.members.map((m) => m.name).join(" & ")}</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <p className="eyebrow">
              {b.label}{" "}
              <span className={`badge ${b.status === "CLOSED" ? "green" : ""}`}>
                {b.status === "CLOSED" ? "Clôturé" : "En cours"}
              </span>
            </p>
            <h1>{navigation.find((n) => n[0] === view)?.[1]}</h1>
          </div>
          <div className="header-actions">
            <span className="saved">
              {busy ? <Spinner small /> : <CheckCircle2 size={15} />}
              {busy ? "Enregistrement…" : "En local"}
            </span>
            {b.status === "ACTIVE" && state.configured && (
              <button
                className="primary"
                disabled={busy || !b.lines.length}
                onClick={() => actions.expense()}
              >
                <Plus size={17} />
                Une dépense
              </button>
            )}
          </div>
        </header>
        {!dialog && error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        {notice && <Toast message={notice} dismiss={() => setNotice("")} />}
        {loadingTask === "import" && (
          <div className="task-indicator" role="status">
            <Spinner small />
            Lecture de votre sauvegarde…
          </div>
        )}
        <fieldset
          className="workspace"
          disabled={busy}
          aria-busy={busy}
          key={view}
        >
          {!state.configured ? (
            <section className="panel onboarding">
              <div className="onboarding-story">
                <span className="eyebrow">VOTRE NOUVEAU RITUEL À DEUX</span>
                <h2>
                  Les comptes au clair.
                  <br />
                  <em>Les projets en tête.</em>
                </h2>
                <HeroArt />
                <div className="onboarding-trust">
                  <LockKeyhole size={15} />
                  <span>Un espace privé, juste pour vous.</span>
                </div>
              </div>
              <div className="onboarding-form">
                <span className="eyebrow">Étape 1 · Faisons connaissance</span>
                <h2>Préparons votre budget à deux</h2>
                <p>
                  On commence par vos prénoms et vos salaires mensuels nets.
                  Ensuite, je vous accompagne pour le logement, les courses et
                  vos projets. Quelques petites étapes, et chacun saura quelle
                  est sa part.
                </p>
                <HouseholdForm
                  state={state}
                  busy={busy}
                  submit={(data) =>
                    attempt(() => {
                      const month = String(data.get("month"));
                      void commit(
                        (s) =>
                          configureHousehold(
                            s,
                            s.members.map((m) =>
                              String(data.get(`name-${m.id}`)),
                            ),
                            s.members.map((m) =>
                              parseMoney(data.get(`income-${m.id}`), true),
                            ),
                            month,
                            month,
                          ),
                        "Votre foyer est prêt. Renseignez maintenant les montants des enveloppes.",
                      ).then((ok) => {
                        if (ok) {
                          go("budget");
                          open({ type: "coach" });
                        }
                      });
                    })
                  }
                />
                <hr />
                <label className="field">
                  Vous avez déjà une sauvegarde BUDG ?
                  <input
                    type="file"
                    disabled={loadingTask !== null}
                    accept=".json,application/json"
                    onChange={(e) => {
                      void readImport(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </section>
          ) : (
            <>
              {(view === "dashboard" || view === "budget") && (
                <BudgetGuide
                  state={state}
                  actions={actions}
                  prepare={() => open({ type: "coach" })}
                  payments={() => go("payments")}
                />
              )}
              {view === "dashboard" && (
                <Dashboard
                  state={state}
                  actions={actions}
                  openBudget={() => go("budget")}
                />
              )}
              {view === "budget" && (
                <>
                  <div className="section-head">
                    <div>
                      <h2>Votre budget mensuel</h2>
                      <p>
                        Les montants prévus seront repris le mois suivant.
                        L’argent n’est considéré reçu qu’après saisie d’un
                        versement.
                      </p>
                    </div>
                    {b.status === "ACTIVE" && (
                      <button
                        className="primary"
                        onClick={() => actions.line()}
                      >
                        <Plus size={17} />
                        Nouvelle enveloppe
                      </button>
                    )}
                  </div>
                  <Envelopes budget={b} actions={actions} />
                  {b.status === "ACTIVE" && (
                    <EnvelopeSuggestions
                      lines={b.lines}
                      choose={(template) => open({ type: "line", template })}
                    />
                  )}
                </>
              )}
              {view === "expenses" && (
                <Transactions budget={b} actions={actions} mode="expenses" />
              )}
              {view === "payments" && (
                <>
                  <Members budget={b} actions={actions} />
                  <Transactions budget={b} actions={actions} mode="payments" />
                </>
              )}
              {view === "pot" && <CommonPot state={state} actions={actions} />}
              {view === "history" && <History state={state} />}
              {view === "settings" && (
                <div className="settings-layout">
                  <section className="panel">
                    <h2>Votre foyer et vos salaires</h2>
                    <p>
                      Le mois d’effet conserve les anciennes répartitions. Une
                      modification ne change jamais un mois clôturé.
                    </p>
                    <HouseholdForm
                      state={state}
                      busy={busy}
                      submit={(data) =>
                        attempt(() => {
                          void commit((s) =>
                            configureHousehold(
                              s,
                              s.members.map((m) =>
                                String(data.get(`name-${m.id}`)),
                              ),
                              s.members.map((m) =>
                                parseMoney(data.get(`income-${m.id}`), true),
                              ),
                              String(data.get("month")),
                            ),
                          );
                        })
                      }
                    />
                    <details>
                      <summary>Historique et changements programmés</summary>
                      {[...state.incomeHistory]
                        .sort((a, c) =>
                          c.effectiveFrom.localeCompare(a.effectiveFrom),
                        )
                        .map((h) => (
                          <p key={`${h.memberId}-${h.effectiveFrom}`}>
                            {
                              state.members.find((m) => m.id === h.memberId)
                                ?.name
                            }{" "}
                            · {euro(h.amountCents)} · à partir de{" "}
                            {monthLabel(h.effectiveFrom)}
                          </p>
                        ))}
                    </details>
                  </section>
                  <section className="panel">
                    <h2>Sauvegardes</h2>
                    <p>
                      {storageLabel}. Les 20 versions précédentes sont
                      conservées automatiquement.
                    </p>
                    <p className="hint">
                      Exportez aussi un fichier dans un dossier sauvegardé : les
                      copies locales ne protègent pas d’une perte de
                      l’ordinateur ou d’un effacement du navigateur.
                    </p>
                    <div className="stack">
                      <button
                        className="secondary"
                        onClick={() => exportBackup(state)}
                      >
                        <Download size={17} />
                        Exporter une sauvegarde
                      </button>
                      <label className="field">
                        Importer une sauvegarde BUDG
                        <input
                          type="file"
                          disabled={loadingTask !== null}
                          accept=".json,application/json"
                          onChange={(e) => {
                            void readImport(e.target.files?.[0]);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <button
                        className="secondary"
                        disabled={loadingTask !== null}
                        aria-busy={loadingTask === "backups"}
                        onClick={() => {
                          void listBackups();
                        }}
                      >
                        {loadingTask === "backups" && <Spinner small />}
                        {loadingTask === "backups"
                          ? "Chargement des copies…"
                          : "Afficher les copies automatiques"}
                      </button>
                      {backups.map((copy) => (
                        <div className="backup-row" key={copy.id}>
                          <span>
                            {copy.createdAt
                              ? new Date(copy.createdAt).toLocaleString("fr-FR")
                              : `Version ${copy.state.revision}`}{" "}
                            · {copy.state.budget.label}
                          </span>
                          <button
                            className="text-button"
                            onClick={() =>
                              attempt(() => {
                                const restored = validateState(copy.state);
                                confirm(
                                  "Restaurer cette version ?",
                                  "Les données actuelles seront remplacées et conservées dans une nouvelle copie automatique.",
                                  (s) => ({
                                    ...restored,
                                    revision: s.revision,
                                  }),
                                );
                              })
                            }
                          >
                            Restaurer
                          </button>
                        </div>
                      ))}
                    </div>
                    <hr />
                    <h3>Repartir sans opérations</h3>
                    <p>
                      Conserve vos noms, vos revenus et vos enveloppes. Supprime
                      les dépenses, versements, réserves reportées et archives.
                    </p>
                    <button
                      className="danger-button"
                      onClick={() =>
                        confirm(
                          "Effacer les opérations financières ?",
                          "Les opérations, le pot commun et les archives seront effacés. Vos enveloppes et vos revenus sont conservés. Une copie automatique sera créée.",
                          resetState,
                        )
                      }
                    >
                      Effacer les opérations
                    </button>
                    <hr />
                    <h3>Recommencer depuis le début</h3>
                    <p>
                      Remet les salaires à zéro, efface vos prénoms, vos
                      enveloppes personnalisées et toutes les opérations. Vous
                      retrouvez le guide de démarrage et les enveloppes
                      proposées, sans montant.
                    </p>
                    <button
                      className="danger-button"
                      onClick={() =>
                        confirm(
                          "Tout réinitialiser ?",
                          "Vos prénoms, salaires, changements de revenus programmés, enveloppes personnalisées, dépenses, versements, réserves, pot commun et archives seront retirés du budget actif. Vous reviendrez au premier écran. Une sauvegarde automatique sera conservée pour pouvoir revenir en arrière ; les sauvegardes existantes ne sont pas supprimées.",
                          resetEverything,
                        )
                      }
                    >
                      Tout réinitialiser
                    </button>
                  </section>
                  <section className="panel usage">
                    <h2>Votre routine en quatre étapes</h2>
                    <ol>
                      <li>
                        Préparez les enveloppes et vérifiez la contribution de
                        chacun.
                      </li>
                      <li>
                        Enregistrez les virements reçus sur le compte commun.
                      </li>
                      <li>
                        Saisissez les achats et prélèvements réellement
                        effectués.
                      </li>
                      <li>
                        Clôturez le mois pour garder le surplus dans le pot
                        commun, puis préparez le suivant.
                      </li>
                    </ol>
                    <p>
                      Le solde affiché est calculé à partir de vos saisies.
                      Aucune connexion bancaire ni aucun virement automatique.
                    </p>
                  </section>
                </div>
              )}
            </>
          )}
        </fieldset>
      </main>
      {dialog?.type === "line" && (
        <Modal
          title={dialog.line ? "Modifier l’enveloppe" : "Nouvelle enveloppe"}
          close={closeDialog}
        >
          {activeDialogError}
          <LineForm
            line={dialog.line ?? dialog.template}
            busy={busy}
            submit={(data) =>
              attempt(() => {
                const day = String(data.get("dueDay") ?? "");
                void submit((s) =>
                  saveLine(s, {
                    id: dialog.line?.id ?? uid(),
                    name: String(data.get("name")),
                    plannedCents: parseMoney(data.get("amount"), true),
                    expenseGroup: String(
                      data.get("group"),
                    ) as BudgetLine["expenseGroup"],
                    kind: String(data.get("kind")) as BudgetLine["kind"],
                    dueDay: day ? Number(day) : undefined,
                  }),
                );
              })
            }
          />
        </Modal>
      )}
      {dialog?.type === "expense" && (
        <Modal
          title={
            dialog.expense ? "Modifier la dépense" : "Enregistrer une dépense"
          }
          close={closeDialog}
        >
          {activeDialogError}
          <ExpenseForm
            state={state}
            lineId={dialog.lineId}
            expense={dialog.expense}
            busy={busy}
            submit={(data) =>
              attempt(() => {
                void submit(
                  (s) =>
                    saveExpense(
                      s,
                      {
                        id: dialog.expense?.id ?? uid(),
                        lineId: String(data.get("lineId")),
                        amountCents: parseMoney(data.get("amount")),
                        date: String(data.get("date")),
                        description: String(data.get("description")),
                      },
                      data.get("settled") === "on",
                    ),
                  "Dépense enregistrée et déduite de l’enveloppe.",
                );
              })
            }
          />
        </Modal>
      )}
      {dialog?.type === "payment" && (
        <Modal
          title={
            dialog.payment
              ? "Modifier le versement"
              : "Enregistrer un versement reçu"
          }
          close={closeDialog}
        >
          {activeDialogError}
          <PaymentForm
            state={state}
            memberId={dialog.memberId}
            payment={dialog.payment}
            busy={busy}
            submit={(data) =>
              attempt(() => {
                void submit(
                  (s) =>
                    savePayment(s, {
                      id: dialog.payment?.id ?? uid(),
                      memberId: String(data.get("memberId")),
                      amountCents: parseMoney(data.get("amount")),
                      date: String(data.get("date")),
                      note: String(data.get("note")),
                    }),
                  "Versement enregistré : les enveloppes sont actualisées.",
                );
              })
            }
          />
        </Modal>
      )}
      {dialog?.type === "coach" && (
        <Modal title="Construisons vos enveloppes" close={closeDialog}>
          {activeDialogError}
          <EnvelopeCoach
            state={state}
            busy={busy}
            save={(line, amount) =>
              commit(
                (s) => saveLine(s, { ...line, plannedCents: amount }),
                "Une enveloppe de plus, votre budget prend forme !",
              )
            }
            finish={() => {
              setDialog(null);
              go("dashboard");
            }}
            custom={() => {
              setDialog(null);
              go("budget");
            }}
          />
        </Modal>
      )}
      {dialog?.type === "monthlyIncome" && (
        <Modal title="Les salaires de ce nouveau mois" close={closeDialog}>
          {activeDialogError}
          <MonthlyIncomeForm
            state={state}
            busy={busy}
            submit={(data) =>
              attempt(() => {
                const incomes = state.members.map((m) =>
                  parseMoney(data.get(`income-${m.id}`), true),
                );
                void submit(
                  (s) => confirmMonthlyIncomes(s, incomes),
                  "Salaires confirmés et nouveau mois préparé.",
                ).then((ok) => {
                  if (ok) setView("dashboard");
                });
              })
            }
          />
        </Modal>
      )}
      {dialog?.type === "close" && (
        <Modal title={`Clôturer ${b.label}`} close={closeDialog}>
          {activeDialogError}
          <p>
            Vérifiez que tous les achats et prélèvements du mois ont été saisis.
            La clôture fige les dépenses et les versements.
          </p>
          <div className="metrics two">
            <Metric
              label="Encore à verser"
              value={euro(summary.missingCents)}
            />
            <Metric
              label="Réserves à conserver"
              value={euro(summary.reservedCents)}
            />
          </div>
          {summary.unpaidBills.length > 0 && (
            <div className="alert warning">
              Factures à confirmer :{" "}
              {summary.unpaidBills.map((l) => l.name).join(", ")}. Enregistrez
              leur paiement ou confirmez qu’il ne reste rien à régler dans
              Enveloppes.
            </div>
          )}
          <Metric
            label="Surplus à conserver dans le pot commun"
            value={euro(summary.surplusCents)}
            detail="Les réserves affectées sont exclues de ce montant"
            tone="green"
          />
          <p className="hint">
            Cette somme reste sur le compte commun. Elle sera identifiée « Pot
            commun », sans remboursement personnel et sans nouveau virement.
            Elle s’ajoute au pot existant de{" "}
            {euro(potSummary(state).availableCents)}.
          </p>
          <Form
            busy={busy}
            button="Clôturer et conserver le surplus"
            submit={() => {
              void submit(
                closeMonth,
                "Mois clôturé. Le surplus a rejoint votre pot commun.",
              ).then((ok) => {
                if (ok) setView("pot");
              });
            }}
          >
            <label className="checkbox">
              <input type="checkbox" required />
              Toutes les dépenses du mois sont enregistrées.
            </label>
          </Form>
        </Modal>
      )}
      {dialog?.type === "potExpense" && (
        <Modal
          title={
            dialog.expense
              ? "Modifier la dépense du pot commun"
              : "Utiliser le pot commun"
          }
          close={closeDialog}
        >
          {activeDialogError}
          <p>
            Disponible :{" "}
            <b>
              {euro(
                potSummary(state).availableCents +
                  (dialog.expense?.amountCents ?? 0),
              )}
            </b>
            . Enregistrez un achat déjà payé depuis le compte commun ; il sera
            identifié « Pot commun ».
          </p>
          <Form
            busy={busy}
            submit={(data) =>
              attempt(() => {
                void submit(
                  (s) =>
                    savePotExpense(s, {
                      id: dialog.expense?.id ?? uid(),
                      amountCents: parseMoney(data.get("amount")),
                      date: String(data.get("date")),
                      description: String(data.get("description")),
                    }),
                  "Dépense enregistrée dans le pot commun.",
                );
              })
            }
          >
            <Field
              label="Montant payé (€)"
              name="amount"
              value={dialog.expense ? dialog.expense.amountCents / 100 : ""}
            />
            <Field
              label="Date de la dépense"
              name="date"
              type="date"
              value={dialog.expense?.date ?? today()}
              max={today()}
            />
            <Field
              label="Description"
              name="description"
              value={dialog.expense?.description}
              placeholder="Ex. Sortie à deux"
            />
          </Form>
        </Modal>
      )}
      {dialog?.type === "confirm" && (
        <Modal title={dialog.title} close={closeDialog}>
          {activeDialogError}
          <p>{dialog.message}</p>
          <div className="actions">
            <button className="secondary" disabled={busy} onClick={closeDialog}>
              Annuler
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void submit(dialog.action);
              }}
            >
              {busy && <Spinner />}
              {busy ? "Enregistrement…" : "Confirmer"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Recovery({ error }: { error: string }) {
  const [message, setMessage] = useState(error),
    [copies, setCopies] = useState<Backup[]>([]);
  const [candidate, setCandidate] = useState<AppState | null>(null),
    [busy, setBusy] = useState(false);
  async function choose(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10_000_000) throw new Error("Fichier trop volumineux.");
      setCandidate(validateState(JSON.parse(await file.text())));
    } catch (e) {
      setMessage(errorMessage(e));
    }
  }
  async function restore() {
    if (!candidate || busy) return;
    setBusy(true);
    try {
      await repository.recover(candidate);
      window.location.reload();
    } catch (e) {
      setMessage(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <div className="loading panel">
      <h1>Récupérer votre budget</h1>
      <p className="alert error" role="alert">
        {message}
      </p>
      <p>
        Vos données n’ont pas été remplacées. Vous pouvez réessayer ou choisir
        une sauvegarde à restaurer.
      </p>
      <div className="stack">
        <button className="secondary" onClick={() => window.location.reload()}>
          Réessayer
        </button>
        <label className="field">
          Choisir une sauvegarde
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
            }}
          />
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            void repository
              .backups()
              .then(setCopies)
              .catch((e) => setMessage(errorMessage(e)));
          }}
        >
          Afficher les copies automatiques
        </button>
        {copies.map((copy) => (
          <button
            className="secondary"
            key={copy.id}
            disabled={busy}
            onClick={() => {
              try {
                setCandidate(validateState(copy.state));
              } catch (e) {
                setMessage(errorMessage(e));
              }
            }}
          >
            Version {copy.state.revision} · {copy.state.budget.label}
          </button>
        ))}
        {candidate && (
          <div className="notice">
            <p>
              Restaurer {candidate.budget.label}, avec{" "}
              {candidate.archivedBudgets.length} mois archivé(s) ? Cette
              sauvegarde remplacera les données locales actuelles.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                void restore();
              }}
            >
              {busy && <Spinner />}
              {busy ? "Restauration…" : "Confirmer la restauration"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
