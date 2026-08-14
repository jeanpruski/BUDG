import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Download,
  History,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Receipt,
  Settings,
  Sparkles,
  Target,
  Trash2,
  Upload,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import { budgetSummary, cents, closeBudget, euro, sharesFor, splitAmount } from "./domain";
import { AppState, loadState, resetState, saveState } from "./store";
type View =
  | "dashboard"
  | "budget"
  | "expenses"
  | "contributions"
  | "surplus"
  | "projects"
  | "history"
  | "settings";
const navigation: [View, string, typeof Home][] = [
  ["dashboard", "Tableau de bord", Home],
  ["budget", "Budget", WalletCards],
  ["expenses", "Dépenses", Receipt],
  ["contributions", "Contributions", Users],
  ["surplus", "Surplus", CircleDollarSign],
  ["projects", "Projets", Target],
  ["history", "Historique", History],
  ["settings", "Paramètres", Settings],
];
const iso = () => new Date().toISOString().slice(0, 10);
export default function App() {
  const [state, setState] = useState<AppState>(loadState),
    [view, setView] = useState<View>("dashboard"),
    [modal, setModal] = useState<
      | "expense"
      | "payment"
      | "project"
      | "income"
      | "month"
      | "budgetLine"
      | null
    >(null),
    [member, setMember] = useState<string | null>(null),
    [selectedProject, setSelectedProject] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [collapsed, setCollapsed] = useState(
      () => localStorage.getItem("budg-sidebar-collapsed") === "true",
    );
  const summary = useMemo(
    () => budgetSummary(state.budget, state.members),
    [state],
  );
  useEffect(() => saveState(state), [state]);
  const update = (f: (s: AppState) => AppState) => setState((s) => f(s));
  const go = (v: View) => {
    setView(v);
    setMenu(false);
  };
  function expense(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      n = Number(String(d.get("amount")).replace(",", "."));
    if (n <= 0) return;
    update((s) => ({
      ...s,
      budget: {
        ...s.budget,
        expenses: [
          ...s.budget.expenses,
          {
            id: crypto.randomUUID(),
            lineId: String(d.get("line")),
            amountCents: cents(n),
            date: String(d.get("date")),
            description: String(d.get("description")),
          },
        ],
      },
    }));
    setModal(null);
  }
  function payment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      n = Number(String(d.get("amount")).replace(",", "."));
    if (!member || n <= 0) return;
    update((s) => ({
      ...s,
      budget: {
        ...s.budget,
        payments: [
          ...s.budget.payments,
          {
            id: crypto.randomUUID(),
            memberId: member,
            amountCents: cents(n),
            date: String(d.get("date")),
            note: String(d.get("note") || ""),
          },
        ],
      },
    }));
    setModal(null);
  }
  function project(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      target = Number(d.get("target")),
      name = String(d.get("name"));
    update((s) => ({
      ...s,
      projects: selectedProject
        ? s.projects.map((p) =>
            p.id === selectedProject
              ? { ...p, name, targetCents: target ? cents(target) : undefined }
              : p,
          )
        : [
            ...s.projects,
            {
              id: crypto.randomUUID(),
              name,
              targetCents: target ? cents(target) : undefined,
              allocatedCents: 0,
            },
          ],
    }));
    setSelectedProject(null);
    setModal(null);
  }
  function budgetLine(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      amount = cents(Number(String(d.get("amount")).replace(",", "."))),
      allocationType = String(d.get("allocationType")) as
        "PRO_RATA" | "FIFTY_FIFTY",
      expenseGroup = String(d.get("expenseGroup")) as "HOUSING" | "DAILY_LIFE";
    if (amount <= 0) return;
    update((s) => ({
      ...s,
      budget: {
        ...s.budget,
        lines: [
          ...s.budget.lines,
          {
            id: crypto.randomUUID(),
            name: String(d.get("name")),
            plannedCents: amount,
            allocationType,
            expenseGroup,
            shares: sharesFor(amount, allocationType, s.members),
          },
        ],
      },
    }));
    setModal(null);
  }
  function removeBudgetLine(id: string) {
    update((s) =>
      s.budget.status === "CLOSED"
        ? s
        : {
            ...s,
            budget: {
              ...s.budget,
              lines: s.budget.lines.filter((l) => l.id !== id),
              expenses: s.budget.expenses.filter((e) => e.lineId !== id),
            },
          },
    );
  }
  function allocateProject(id: string) {
    const raw = prompt("Montant à affecter depuis le Surplus (€)");
    if (raw === null) return;
    const amount = cents(Number(raw.replace(",", ".")));
    if (amount <= 0 || amount > state.surplusCents) {
      alert("Montant invalide ou supérieur au Surplus disponible.");
      return;
    }
    update((s) => ({
      ...s,
      surplusCents: s.surplusCents - amount,
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, allocatedCents: p.allocatedCents + amount } : p,
      ),
      surplusEntries: [
        {
          id: crypto.randomUUID(),
          amountCents: -amount,
          label: `Affectation ${s.projects.find((p) => p.id === id)?.name}`,
          date: s.budget.label,
          type: "allocation",
        },
        ...s.surplusEntries,
      ],
    }));
  }
  function quickAddBudgetLine() {
    if (state.budget.status === "CLOSED") return;
    const name = prompt("Nom de l’enveloppe");
    if (!name) return;
    const raw = prompt("Montant prévu (€)");
    if (!raw) return;
    const amount = cents(Number(raw.replace(",", ".")));
    if (amount <= 0) return;
    const housing = confirm(
      "Cette enveloppe concerne-t-elle l’appartement ?\nOK = Appartement · Annuler = Vie quotidienne",
    );
    const prorata = confirm(
      "Répartition au prorata des revenus ?\nOK = Prorata · Annuler = 50/50",
    );
    update((s) => ({
      ...s,
      budget: {
        ...s.budget,
        lines: [
          ...s.budget.lines,
          {
            id: crypto.randomUUID(),
            name,
            plannedCents: amount,
            allocationType: prorata ? "PRO_RATA" : "FIFTY_FIFTY",
            expenseGroup: housing ? "HOUSING" : "DAILY_LIFE",
            shares: sharesFor(
              amount,
              prorata ? "PRO_RATA" : "FIFTY_FIFTY",
              s.members,
            ),
          },
        ],
      },
    }));
  }
  function editBudgetLine(id: string) {
    const current = state.budget.lines.find((line) => line.id === id);
    if (!current || state.budget.status === "CLOSED") return;
    const name = prompt("Nom de l’enveloppe", current.name);
    if (!name) return;
    const raw = prompt(
      "Montant prévu (€)",
      String(current.plannedCents / 100),
    );
    if (raw === null) return;
    const amount = cents(Number(raw.replace(",", ".")));
    if (amount <= 0) return;
    const housing = confirm(
      "Cette enveloppe concerne-t-elle l’appartement ?\nOK = Appartement · Annuler = Vie quotidienne",
    );
    const prorata = confirm(
      "Répartition au prorata des revenus ?\nOK = Prorata · Annuler = 50/50",
    );
    update((s) => ({
      ...s,
      budget: {
        ...s.budget,
        lines: s.budget.lines.map((line) =>
          line.id === id
            ? {
                ...line,
                name,
                plannedCents: amount,
                expenseGroup: housing ? "HOUSING" : "DAILY_LIFE",
                allocationType: prorata ? "PRO_RATA" : "FIFTY_FIFTY",
                shares: sharesFor(
                  amount,
                  prorata ? "PRO_RATA" : "FIFTY_FIFTY",
                  s.members,
                ),
              }
            : line,
        ),
      },
    }));
  }
  function editProject(id: string) {
    const current = state.projects.find((p) => p.id === id);
    if (!current) return;
    const name = prompt("Nom du projet", current.name);
    if (!name) return;
    const targetRaw = prompt(
      "Objectif (€)",
      String((current.targetCents ?? 0) / 100),
    );
    if (targetRaw === null) return;
    const target = cents(Number(targetRaw.replace(",", ".")));
    update((s) => ({
      ...s,
      projects: s.projects.map((p) =>
        p.id === id
          ? { ...p, name, targetCents: target > 0 ? target : undefined }
          : p,
      ),
    }));
  }
  function income(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget),
      amount = Number(String(d.get("amount")).replace(",", ".")),
      effectiveFrom = String(d.get("effectiveFrom"));
    if (!member || amount < 0) return;
    update((s) => {
      const appliesToCurrent =
          effectiveFrom <= s.budget.id && s.budget.status !== "CLOSED",
        members = appliesToCurrent
          ? s.members.map((m) =>
              m.id === member ? { ...m, incomeCents: cents(amount) } : m,
            )
          : s.members,
        budget = appliesToCurrent
          ? {
              ...s.budget,
              lines: s.budget.lines.map((l) => ({
                ...l,
                shares: sharesFor(l.plannedCents, l.allocationType, members),
              })),
            }
          : s.budget;
      return {
        ...s,
        members,
        budget,
        incomeHistory: [
          ...s.incomeHistory,
          {
            id: crypto.randomUUID(),
            memberId: member,
            amountCents: cents(amount),
            effectiveFrom,
            createdAt: new Date().toISOString(),
          },
        ],
      };
    });
    setModal(null);
  }
  function close() {
    if (
      !confirm(
        `Clôturer ${state.budget.label} et transférer ${euro(summary.transferableSurplusCents)} ?`,
      )
    )
      return;
    update((s) => {
      const b = closeBudget(s.budget, s.members),
        amount = b.closedSurplusCents ?? 0;
      return {
        ...s,
        budget: b,
        surplusCents: s.surplusCents + amount,
        surplusEntries: amount
          ? [
              {
                id: crypto.randomUUID(),
                amountCents: amount,
                label: `Clôture ${b.label}`,
                date: b.label,
                type: "saving",
              },
              ...s.surplusEntries,
            ]
          : s.surplusEntries,
      };
    });
  }
  function exportData() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    );
    a.download = "budg-backup.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function importData(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        setState(JSON.parse(String(r.result)));
      } catch {
        alert("Sauvegarde invalide");
      }
    };
    r.readAsText(f);
  }
  function switchMonth(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = String(new FormData(e.currentTarget).get("month"));
    if (!id || id === state.budget.id) {
      setModal(null);
      return;
    }
    update((s) => {
      const existing = s.archivedBudgets.find((b) => b.id === id),
        label = new Date(`${id}-02`)
          .toLocaleDateString("fr-FR", { month: "long", year: "numeric" })
          .replace(/^./, (c) => c.toUpperCase()),
        budget = existing ?? {
          id,
          label,
          status: "ACTIVE",
          lines: s.budget.lines.map((l) => ({
            ...l,
            shares: sharesFor(l.plannedCents, l.allocationType, s.members),
          })),
          expenses: [],
          payments: [],
        };
      return {
        ...s,
        budget,
        archivedBudgets: [
          ...s.archivedBudgets.filter((b) => b.id !== id),
          s.budget,
        ],
      };
    });
    setModal(null);
    go("dashboard");
  }
  function toggleSidebar() {
    setCollapsed((v) => {
      localStorage.setItem("budg-sidebar-collapsed", String(!v));
      return !v;
    });
  }
  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={menu ? "open" : ""}>
        <div className="logo">
          <img src="/assets/budg-logo.png" alt="Logo BUDG" />
          <b>BUDG</b>
          <button
            className="collapse-button"
            aria-label={
              collapsed ? "Déplier la navigation" : "Replier la navigation"
            }
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <button className="close-menu" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav>
          {navigation.map(([id, label, I]) => (
            <button
              title={label}
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => go(id)}
            >
              <I size={18} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <button
          className="month-pick"
          onClick={() => setModal("month")}
          title={`Changer de mois — ${state.budget.label}`}
        >
          <CalendarDays size={16} />
          <b>{state.budget.label}</b>
          <ChevronRight size={16} />
        </button>
        <button
          className="household"
          onClick={() => go("settings")}
          title="Configurer le foyer"
        >
          <span>JM</span>
          <div>
            <b>{state.householdName}</b>
            <small>Foyer actif</small>
          </div>
          <ChevronRight size={15} />
        </button>
      </aside>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}
      <main>
        <header>
          <button className="menu-button" onClick={() => setMenu(true)}>
            <Menu />
          </button>
          <div>
            <h1>
              {view === "dashboard" ? (
                "Tableau de bord"
              ) : (
                navigation.find((n) => n[0] === view)?.[1]
              )}
            </h1>
            <p>
              {view === "dashboard"
                ? `Voici votre situation pour ${state.budget.label.toLowerCase()}.`
                : state.budget.label}
            </p>
          </div>
          <div className="header-icons">
            <button
              aria-label="Ouvrir les paramètres"
              onClick={() => go("settings")}
            >
              <Settings size={19} />
            </button>
          </div>
        </header>
        {view === "dashboard" && (
          <Dashboard
            s={state}
            summary={summary}
            go={go}
            pay={(id: string) => {
              setMember(id);
              setModal("payment");
            }}
          />
        )}
        {view === "budget" && (
          <Budget
            s={state}
            summary={summary}
            add={quickAddBudgetLine}
            edit={editBudgetLine}
            remove={removeBudgetLine}
          />
        )}{" "}
        {view === "expenses" && (
          <Expenses
            s={state}
            add={() => setModal("expense")}
            remove={(id) =>
              update((s) => ({
                ...s,
                budget: {
                  ...s.budget,
                  expenses: s.budget.expenses.filter((e) => e.id !== id),
                },
              }))
            }
          />
        )}{" "}
        {view === "contributions" && (
          <Contributions
            s={state}
            summary={summary}
            pay={(id: string) => {
              setMember(id);
              setModal("payment");
            }}
          />
        )}
        {view === "surplus" && <Surplus s={state} />}{" "}
        {view === "projects" && (
          <Projects
            s={state}
            add={() => {
              setSelectedProject(null);
              setModal("project");
            }}
            edit={editProject}
            remove={(id: string) =>
              confirm(
                "Supprimer ce projet ? Le montant affecté sera rendu au Surplus.",
              ) &&
              update((s) => {
                const p = s.projects.find((x) => x.id === id);
                return {
                  ...s,
                  surplusCents: s.surplusCents + (p?.allocatedCents ?? 0),
                  projects: s.projects.filter((x) => x.id !== id),
                };
              })
            }
            allocate={allocateProject}
          />
        )}{" "}
        {view === "history" && <HistoryView s={state} />}{" "}
        {view === "settings" && (
          <SettingsView
            s={state}
            setState={setState}
            exportData={exportData}
            importData={importData}
            editIncome={(id: string) => {
              setMember(id);
              setModal("income");
            }}
          />
        )}{" "}
        {view === "dashboard" && state.budget.status !== "CLOSED" && (
          <button className="close-month" onClick={close}>
            Clôturer le mois <ChevronRight size={17} />
          </button>
        )}
      </main>
      <MobileNav view={view} go={go} add={() => setModal("expense")} />
      {modal === "expense" && (
        <Modal title="Retirer d’une enveloppe" close={() => setModal(null)}>
          <form onSubmit={expense}>
            <p className="form-hint">
              Enregistrez ici une sortie du compte commun. Le montant sera
              retiré de l’enveloppe choisie et son reste sera recalculé
              immédiatement.
            </p>
            <Field
              label="Montant retiré (€)"
              name="amount"
              placeholder="100,00"
            />
            <label>
              Enveloppe concernée
              <select name="line">
                <optgroup label="Appartement">
                  {state.budget.lines
                    .filter((l) => l.expenseGroup === "HOUSING")
                    .map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.name} — reste{" "}
                        {euro(
                          Math.max(
                            0,
                            l.plannedCents -
                              state.budget.expenses
                                .filter((e) => e.lineId === l.id)
                                .reduce((n, e) => n + e.amountCents, 0),
                          ),
                        )}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="Vie quotidienne">
                  {state.budget.lines
                    .filter((l) => l.expenseGroup !== "HOUSING")
                    .map((l) => (
                      <option value={l.id} key={l.id}>
                        {l.name} — reste{" "}
                        {euro(
                          Math.max(
                            0,
                            l.plannedCents -
                              state.budget.expenses
                                .filter((e) => e.lineId === l.id)
                                .reduce((n, e) => n + e.amountCents, 0),
                          ),
                        )}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <Field
              label="Motif de la sortie"
              name="description"
              placeholder="Ex. Courses Carrefour"
            />
            <Field label="Date" name="date" type="date" value={iso()} />
            <button className="primary full">Confirmer la sortie</button>
          </form>
        </Modal>
      )}
      {modal === "payment" && member && (
        <Modal
          title={`Versement de ${state.members.find((m) => m.id === member)?.name}`}
          close={() => setModal(null)}
        >
          <form onSubmit={payment}>
            <div className="payment-context">
              <span>
                Compte destinataire<b>Compte commun · {state.budget.label}</b>
              </span>
              <span>
                Contribution attendue<b>{euro(summary.expected[member])}</b>
              </span>
              <span>
                Déjà versé<b>{euro(summary.paid[member])}</b>
              </span>
              <span>
                Reste à verser
                <b className="orange">
                  {euro(
                    Math.max(
                      0,
                      summary.expected[member] - summary.paid[member],
                    ),
                  )}
                </b>
              </span>
            </div>
            <Field
              label="Montant du versement (€)"
              name="amount"
              placeholder={(
                Math.max(0, summary.expected[member] - summary.paid[member]) /
                100
              ).toFixed(2)}
            />
            <Field
              label="Date du versement"
              name="date"
              type="date"
              value={iso()}
            />
            <Field
              label="Note"
              name="note"
              placeholder="Ex. Virement compte commun"
              required={false}
            />
            <p className="form-hint">
              Ce versement finance la contribution globale du mois. Il n’est pas
              rattaché à une dépense ou une catégorie particulière.
            </p>
            <button className="primary full">Confirmer le versement</button>
          </form>
        </Modal>
      )}
      {modal === "project" && (
        <Modal title="Nouveau projet" close={() => setModal(null)}>
          <form onSubmit={project}>
            <Field label="Nom" name="name" placeholder="Ex. Vacances" />
            <Field label="Objectif (€)" name="target" placeholder="2 000" />
            <button className="primary full">Créer le projet</button>
          </form>
        </Modal>
      )}
      {modal === "income" && (
        <Modal
          title={`Nouveau revenu — ${state.members.find((m) => m.id === member)?.name}`}
          close={() => setModal(null)}
        >
          <form onSubmit={income}>
            <Field
              label="Revenu net mensuel (€)"
              name="amount"
              placeholder="3 100"
            />
            <Field
              label="Applicable à partir de"
              name="effectiveFrom"
              type="month"
              value={state.budget.id}
            />
            <p className="form-hint">
              Le nouveau ratio est appliqué aux budgets actifs à partir de ce
              mois. Les mois clôturés ne changent jamais.
            </p>
            <button className="primary full">Enregistrer le changement</button>
          </form>
        </Modal>
      )}
      {modal === "month" && (
        <Modal title="Choisir le mois" close={() => setModal(null)}>
          <form onSubmit={switchMonth}>
            <Field
              label="Mois et année"
              name="month"
              type="month"
              value={state.budget.id}
            />
            <p className="form-hint">
              Un mois déjà utilisé conserve ses propres versements, dépenses et
              répartitions. Un nouveau mois reprend les enveloppes actuelles
              avec des compteurs vides.
            </p>
            <button className="primary full">Afficher ce mois</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Dashboard({ s, summary, go, pay }: any) {
  return (
    <>
      <div className="dashboard-grid">
        <Panel title="Contributions" link={() => go("contributions")}>
          <div className="contrib-list">
            {s.members.map((m: any) => {
              const left = Math.max(
                0,
                summary.expected[m.id] - summary.paid[m.id],
              );
              return (
                <div className="person" key={m.id}>
                  <div className={`face ${m.id}`}>{m.name[0]}</div>
                  <div>
                    <b>{m.name}</b>
                    <small>{euro(summary.expected[m.id])} attendus</small>
                  </div>
                  <strong>
                    {euro(summary.paid[m.id])}
                    <small className={left ? "warn" : "ok"}>
                      {left ? `${euro(left)} à verser` : "À jour ✓"}
                    </small>
                  </strong>
                  {left > 0 && (
                    <button onClick={() => pay(m.id)}>
                      <Plus />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
        <Panel title="Budget du mois" link={() => go("budget")}>
          <Donut spent={summary.spentCents} planned={summary.plannedCents} />
          <b className="available">
            {euro(Math.max(0, summary.plannedCents - summary.spentCents))}{" "}
            disponibles
          </b>
        </Panel>
        <Panel title="Pot Surplus" link={() => go("surplus")}>
          <div className="surplus-hero">
            <div>
              <strong>{euro(s.surplusCents)}</strong>
              <span>disponibles</span>
              <b>+170 € ce mois</b>
            </div>
            <img src="/assets/budg-plant.png" />
          </div>
        </Panel>
      </div>
      <div className="lower-grid">
        <BudgetTable s={s} />
        <Recent s={s} go={go} />
      </div>
    </>
  );
}
function Panel({ title, children, link }: any) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      {children}
      <button className="panel-link" onClick={link}>
        Voir le détail <ChevronRight size={14} />
      </button>
    </section>
  );
}
function Donut({ spent, planned }: { spent: number; planned: number }) {
  const p = Math.min(100, (spent / planned) * 100);
  return (
    <div className="donut-wrap">
      <div>
        <b>{euro(planned)}</b>
        <small>prévu</small>
      </div>
      <div
        className="donut"
        style={{ background: `conic-gradient(#2e7559 ${p}%,#dceadf 0)` }}
      >
        <span>
          <b>{euro(spent)}</b>
          <small>dépensés</small>
        </span>
      </div>
    </div>
  );
}
function BudgetTable({ s, detailed = false }: { s: AppState; detailed?: boolean }) {
  return (
    <section className="panel budget-list">
      <h3>Enveloppes du mois</h3>
      {(["HOUSING", "DAILY_LIFE"] as const).map((group) => (
        <div className="budget-group" key={group}>
          <h4>{group === "HOUSING" ? "Appartement" : "Vie quotidienne"}</h4>
          {s.budget.lines
            .filter((l) => (l.expenseGroup ?? "DAILY_LIFE") === group)
            .map((l) => {
              const n = s.budget.expenses
                  .filter((e) => e.lineId === l.id)
                  .reduce((a, b) => a + b.amountCents, 0),
                remaining = l.plannedCents - n,
                p = Math.min(100, (n / l.plannedCents) * 100);
              return (
                <div className="budget-row" key={l.id}>
                  <b>{l.name}</b>
                  <span>{euro(l.plannedCents)} prévus</span>
                  <div>
                    <i
                      className={remaining < 0 ? "over" : ""}
                      style={{ width: `${p}%` }}
                    />
                  </div>
                  <small className={remaining < 0 ? "over-text" : ""}>
                    {remaining >= 0
                      ? `${euro(remaining)} restants`
                      : `${euro(Math.abs(remaining))} dépassés`}
                  </small>
                  {detailed && (
                    <FundingBreakdown line={l} amount={l.plannedCents} members={s.members} />
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </section>
  );
}
function FundingBreakdown({
  line,
  amount,
  members,
}: {
  line: AppState["budget"]["lines"][number];
  amount: number;
  members: AppState["members"];
}) {
  const weights = members.map(
      (member) =>
        line.shares.find((share) => share.memberId === member.id)?.amountCents ??
        0,
    ),
    parts = splitAmount(
      amount,
      weights,
      members.map((member) => member.id),
    );
  return (
    <div className="funding-breakdown">
      <span>Payé par le compte commun</span>
      {members.map((member, index) => (
        <b key={member.id}>
          {member.name} finance {euro(parts[index])}
        </b>
      ))}
    </div>
  );
}
function Recent({ s, go }: { s: AppState; go: (v: View) => void }) {
  return (
    <section className="panel recent">
      <h3>Dépenses récentes</h3>
      {[...s.budget.expenses]
        .reverse()
        .slice(0, 5)
        .map((e) => (
          <div key={e.id}>
            <span>
              <Receipt size={15} />
            </span>
            <p>
              <b>{e.description}</b>
              <small>
                {new Date(e.date).toLocaleDateString("fr-FR", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </small>
            </p>
            <strong>{euro(e.amountCents)}</strong>
          </div>
        ))}
      <button className="panel-link" onClick={() => go("expenses")}>
        Voir toutes les dépenses <ChevronRight size={14} />
      </button>
    </section>
  );
}
function Budget({
  s,
  summary,
  add,
  edit,
  remove,
}: {
  s: AppState;
  summary: any;
  add: () => void;
  edit: (id: string) => void;
  remove: (id: string) => void;
}) {
  return (
    <>
      <div className="budget-explanation">
        <div>
          <h2>Budget prévisionnel · {s.budget.label}</h2>
          <p>
            Ces enveloppes définissent ce que le foyer prévoit de dépenser.
            Elles servent à calculer les contributions attendues, même avant
            toute dépense réelle.
          </p>
        </div>
        <button
          className="primary"
          onClick={add}
          disabled={s.budget.status === "CLOSED"}
        >
          <Plus />
          Nouvelle enveloppe
        </button>
      </div>
      <div className="page-grid">
        <section className="panel summary-card">
          <Donut spent={summary.spentCents} planned={summary.plannedCents} />
          <div className="metric">
            <span>Reste disponible</span>
            <b>
              {euro(Math.max(0, summary.plannedCents - summary.spentCents))}
            </b>
          </div>
          <div className="metric">
            <span>Origine des contributions</span>
            <b>{s.budget.lines.length} enveloppes prévues</b>
          </div>
        </section>
        <section>
          <BudgetTable s={s} detailed />
          <div className="budget-admin panel">
            {s.budget.lines.map((l) => (
              <div key={l.id}>
                <span>
                  <b>{l.name}</b>
                  <small>
                    {euro(l.plannedCents)} · {l.allocationType === "PRO_RATA" ? "Prorata" : "50/50"}
                  </small>
                </span>
                <div className="budget-admin-actions">
                  <button
                    disabled={s.budget.status === "CLOSED"}
                    onClick={() => edit(l.id)}
                  >
                    Modifier
                  </button>
                  <button
                    disabled={s.budget.status === "CLOSED"}
                    onClick={() =>
                      confirm(
                        `Supprimer l’enveloppe ${l.name} et ses sorties ?`,
                      ) && remove(l.id)
                    }
                  >
                    <Trash2 />
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
function Expenses({
  s,
  add,
  remove,
}: {
  s: AppState;
  add: () => void;
  remove: (id: string) => void;
}) {
  return (
    <section className="panel page-panel">
      <div className="section-head">
        <div>
          <h2>Sorties des enveloppes</h2>
          <p>
            {s.budget.expenses.length} sorties ce mois, séparées selon leur
            usage
          </p>
        </div>
        <button className="primary" onClick={add}>
          <Plus />
          Nouvelle sortie
        </button>
      </div>
      {(["HOUSING", "DAILY_LIFE"] as const).map((group) => {
        const lines = s.budget.lines.filter(
            (l) => (l.expenseGroup ?? "DAILY_LIFE") === group,
          ),
          ids = new Set(lines.map((l) => l.id)),
          items = [...s.budget.expenses]
            .filter((e) => ids.has(e.lineId))
            .reverse(),
          total = items.reduce((n, e) => n + e.amountCents, 0);
        return (
          <div className="expense-section" key={group}>
            <div className="expense-group-head">
              <div>
                <span className={group === "HOUSING" ? "housing" : "daily"}>
                  {group === "HOUSING" ? <Home /> : <Receipt />}
                </span>
                <h3>
                  {group === "HOUSING" ? "Appartement" : "Vie quotidienne"}
                </h3>
              </div>
              <strong>{euro(total)} retirés</strong>
            </div>
            <div className="transaction-list">
              {items.map((e) => {
                const line = s.budget.lines.find((l) => l.id === e.lineId);
                return <div className="expense-transaction" key={e.id}>
                  <span className="transaction-icon">
                    <Receipt />
                  </span>
                  <p>
                    <b>{e.description}</b>
                    <small>
                      {s.budget.lines.find((l) => l.id === e.lineId)?.name} ·{" "}
                      {new Date(e.date).toLocaleDateString("fr-FR")}
                    </small>
                  </p>
                  <strong>-{euro(e.amountCents)}</strong>
                  <button
                    className="trash"
                    onClick={() =>
                      confirm("Supprimer cette sortie ?") && remove(e.id)
                    }
                  >
                    <Trash2 />
                  </button>
                  {line && <FundingBreakdown line={line} amount={e.amountCents} members={s.members} />}
                </div>;
              })}
              {items.length === 0 && (
                <p className="empty-group">
                  Aucune sortie réelle enregistrée. Les enveloppes prévues
                  restent visibles dans Budget jusqu’à leur utilisation.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
function Contributions({ s, summary, pay }: any) {
  return (
    <>
      <div className="contribution-intro">
        <div>
          <h2>Compte commun · {s.budget.label}</h2>
          <p>
            Les contributions viennent du budget prévisionnel. Le reste personnel
            indique ce que chacun conserve sur son revenu après avoir financé sa
            part du mois.
          </p>
        </div>
      </div>
      <div className="cards-two">
        {s.members.map((m: any) => {
          const left = Math.max(0, summary.expected[m.id] - summary.paid[m.id]);
          return (
            <section className="panel member-detail" key={m.id}>
              <div className={`face large ${m.id}`}>{m.name[0]}</div>
              <h2>{m.name}</h2>
              <div className="metric">
                <span>Contribution attendue</span>
                <b>{euro(summary.expected[m.id])}</b>
              </div>
              <div className="metric personal-remainder">
                <span>Reste personnel après contribution</span>
                <b
                  className={
                    m.incomeCents - summary.expected[m.id] < 0
                      ? "orange"
                      : "green"
                  }
                >
                  {euro(m.incomeCents - summary.expected[m.id])}
                </b>
              </div>
              <div className="metric">
                <span>Déjà versé</span>
                <b className="green">{euro(summary.paid[m.id])}</b>
              </div>
              <div className="metric">
                <span>{left ? "Reste à verser" : "Statut"}</span>
                <b className={left ? "orange" : "green"}>
                  {left ? euro(left) : "À jour ✓"}
                </b>
              </div>
              <button className="secondary full" onClick={() => pay(m.id)}>
                Ajouter un versement
              </button>
            </section>
          );
        })}
      </div>
      <AllocationBreakdown s={s} />
      <section className="panel page-panel payment-history">
        <h2>Historique des versements</h2>
        <div className="transaction-list">
          {[...s.budget.payments].reverse().map((p: any) => (
            <div key={p.id}>
              <div className={`face ${p.memberId}`}>
                {s.members.find((m: any) => m.id === p.memberId)?.name[0]}
              </div>
              <p>
                <b>
                  {s.members.find((m: any) => m.id === p.memberId)?.name} →
                  Compte commun
                </b>
                <small>
                  {new Date(p.date).toLocaleDateString("fr-FR")}
                  {p.note ? ` · ${p.note}` : ""}
                </small>
              </p>
              <strong className="green">{euro(p.amountCents)}</strong>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
function AllocationBreakdown({ s }: { s: AppState }) {
  const summary = budgetSummary(s.budget, s.members);
  return (
    <section className="panel page-panel allocation-breakdown">
      <div className="section-head">
        <div>
          <h2>Qui paie quoi ?</h2>
          <p>Détail des contributions prévues pour chaque enveloppe.</p>
        </div>
      </div>
      {(["HOUSING", "DAILY_LIFE"] as const).map((group) => {
        const lines = s.budget.lines.filter(
          (line) => (line.expenseGroup ?? "DAILY_LIFE") === group,
        );
        return <div className="allocation-group" key={group}>
          <h3>{group === "HOUSING" ? "Appartement" : "Vie quotidienne"}</h3>
          {lines.map((l) => (
              <div className="allocation-row" key={l.id}>
                <div className="allocation-name">
                  <b>{l.name}</b>
                  <small>
                    {euro(l.plannedCents)} ·{" "}
                    {l.allocationType === "PRO_RATA"
                      ? "Au prorata des revenus"
                      : l.allocationType === "FIFTY_FIFTY"
                        ? "50 / 50"
                        : l.allocationType}
                  </small>
                </div>
                <div className="allocation-members">
                  {s.members.map((m) => {
                    const amount =
                        l.shares.find((x) => x.memberId === m.id)
                          ?.amountCents ?? 0,
                      percent = l.plannedCents
                        ? (amount / l.plannedCents) * 100
                        : 0;
                    return (
                      <div key={m.id}>
                        <span className={`mini-face ${m.id}`}>{m.name[0]}</span>
                        <p>
                          <small>
                            {m.name} · {percent.toFixed(1).replace(".", ",")} %
                          </small>
                          <b>{euro(amount)}</b>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          <div className="allocation-subtotal">
            <span>Total {group === "HOUSING" ? "Appartement" : "Vie quotidienne"}</span>
            {s.members.map((member) => (
              <div key={member.id}>
                <small>{member.name} doit financer</small>
                <b>
                  {euro(
                    lines.reduce(
                      (total, line) =>
                        total +
                        (line.shares.find(
                          (share) => share.memberId === member.id,
                        )?.amountCents ?? 0),
                      0,
                    ),
                  )}
                </b>
              </div>
            ))}
          </div>
        </div>
      })}
      <div className="monthly-contribution-summary">
        <h3>Total du mois</h3>
        {s.members.map((member) => {
          const expected = summary.expected[member.id],
            paid = summary.paid[member.id],
            remaining = Math.max(0, expected - paid),
            personalRemainder = member.incomeCents - expected;
          return (
            <div key={member.id}>
              <span className={`mini-face ${member.id}`}>{member.name[0]}</span>
              <p><b>{member.name}</b><small>Attendu {euro(expected)}</small></p>
              <span><small>Déjà versé</small><b className="green">{euro(paid)}</b></span>
              <span><small>Reste</small><b className={remaining ? "orange" : "green"}>{remaining ? euro(remaining) : "À jour ✓"}</b></span>
              <span><small>Après contribution</small><b className={personalRemainder < 0 ? "orange" : "green"}>{euro(personalRemainder)}</b></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
function Surplus({ s }: { s: AppState }) {
  return (
    <div className="surplus-page">
      <section className="panel surplus-balance">
        <div>
          <span>Solde actuel</span>
          <strong>{euro(s.surplusCents)}</strong>
          <small>argent commun disponible</small>
        </div>
        <img src="/assets/budg-plant.png" />
      </section>
      <section className="panel page-panel">
        <h2>Historique</h2>
        <div className="transaction-list">
          {s.surplusEntries.map((x) => (
            <div key={x.id}>
              <span className="transaction-icon">
                <Sparkles />
              </span>
              <p>
                <b>{x.label}</b>
                <small>{x.date}</small>
              </p>
              <strong className={x.amountCents >= 0 ? "green" : "orange"}>
                {x.amountCents >= 0 ? "+" : ""}
                {euro(x.amountCents)}
              </strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
function Projects({
  s,
  add,
  edit,
  remove,
  allocate,
}: {
  s: AppState;
  add: () => void;
  edit: (id: string) => void;
  remove: (id: string) => void;
  allocate: (id: string) => void;
}) {
  return (
    <section className="panel page-panel">
      <div className="section-head">
        <div>
          <h2>Projets communs</h2>
          <p>Surplus disponible : {euro(s.surplusCents)}</p>
        </div>
        <button className="primary" onClick={add}>
          <Plus />
          Nouveau projet
        </button>
      </div>
      <div className="project-grid">
        {s.projects.map((p) => {
          const ratio = p.targetCents
            ? Math.min(100, (p.allocatedCents / p.targetCents) * 100)
            : 0;
          return (
            <article key={p.id}>
              <div className="project-icon">
                <Target />
              </div>
              <h3>{p.name}</h3>
              <strong>
                {euro(p.allocatedCents)}{" "}
                <small>/ {euro(p.targetCents ?? 0)}</small>
              </strong>
              <div className="bar">
                <i style={{ width: `${ratio}%` }} />
              </div>
              <p>{Math.round(ratio)} % financé</p>
              <div className="project-actions">
                <button onClick={() => allocate(p.id)}>Affecter</button>
                <button onClick={() => edit(p.id)}>Modifier</button>
                <button className="delete" onClick={() => remove(p.id)}>
                  <Trash2 />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
function HistoryView({ s }: { s: AppState }) {
  const budgets = [s.budget, ...s.archivedBudgets].sort((a, b) =>
    b.id.localeCompare(a.id),
  );
  return (
    <section className="panel page-panel">
      <div className="section-head">
        <div>
          <h2>Historique mensuel</h2>
          <p>
            Dépliez un mois pour retrouver son budget, ses sorties et ses
            contributions.
          </p>
        </div>
      </div>
      <div className="history-list">
        {budgets.map((b) => {
          const planned = b.lines.reduce((n, l) => n + l.plannedCents, 0),
            spent = b.expenses.reduce((n, e) => n + e.amountCents, 0),
            paid = b.payments.reduce((n, p) => n + p.amountCents, 0);
          return (
            <details className="history-detail" key={b.id}>
              <summary>
                <CalendarDays />
                <div>
                  <b>{b.label}</b>
                  <span>
                    {b.status === "CLOSED"
                      ? "Budget clôturé"
                      : "Budget en cours"}
                  </span>
                </div>
                <strong>{euro(b.closedSurplusCents ?? 0)} de Surplus</strong>
                <ChevronRight />
              </summary>
              <div className="history-content">
                <div className="history-metrics">
                  <span>
                    Prévu<b>{euro(planned)}</b>
                  </span>
                  <span>
                    Dépensé<b>{euro(spent)}</b>
                  </span>
                  <span>
                    Versé sur le compte<b>{euro(paid)}</b>
                  </span>
                </div>
                <h4>Enveloppes</h4>
                {b.lines.map((l) => {
                  const actual = b.expenses
                    .filter((e) => e.lineId === l.id)
                    .reduce((n, e) => n + e.amountCents, 0);
                  return (
                    <div className="history-line" key={l.id}>
                      <span>{l.name}</span>
                      <b>
                        {euro(actual)} / {euro(l.plannedCents)}
                      </b>
                      <FundingBreakdown
                        line={l}
                        amount={l.plannedCents}
                        members={s.members}
                      />
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </section>
  );
}
function SettingsView({
  s,
  setState,
  exportData,
  importData,
  editIncome,
}: any) {
  const total = s.members.reduce((n: number, m: any) => n + m.incomeCents, 0);
  return (
    <>
      <div className="settings-grid">
        <section className="panel page-panel">
          <h2>Foyer et revenus</h2>
          <p className="muted">
            Les revenus déterminent automatiquement la répartition au prorata.
          </p>
          {s.members.map((m: any) => (
            <div className="setting-row" key={m.id}>
              <div className={`face ${m.id}`}>{m.name[0]}</div>
              <div>
                <b>{m.name}</b>
                <small>
                  {total
                    ? ((m.incomeCents / total) * 100)
                        .toFixed(2)
                        .replace(".", ",")
                    : "0"}{" "}
                  % du revenu du foyer
                </small>
              </div>
              <strong>{euro(m.incomeCents)}</strong>
              <button className="edit-income" onClick={() => editIncome(m.id)}>
                Modifier
              </button>
            </div>
          ))}
        </section>
        <section className="panel page-panel">
          <h2>Données locales</h2>
          <p className="muted">
            Exportez une sauvegarde complète ou restaurez vos données. Rien ne
            quitte cet appareil.
          </p>
          <button className="secondary full" onClick={exportData}>
            <Download />
            Exporter une sauvegarde
          </button>
          <label className="secondary full upload">
            <Upload />
            Restaurer une sauvegarde
            <input
              type="file"
              accept="application/json"
              onChange={importData}
            />
          </label>
          <button
            className="danger-button"
            onClick={() => {
              if (
                confirm(
                  "Effacer toutes les dépenses, versements, projets et le Surplus ? La configuration du foyer et des enveloppes sera conservée.",
                )
              )
                setState(resetState());
            }}
          >
            Effacer les données financières
          </button>
        </section>
      </div>
      <section className="panel page-panel income-history">
        <h2>Historique des revenus</h2>
        <div className="transaction-list">
          {[...s.incomeHistory]
            .sort((a: any, b: any) =>
              b.effectiveFrom.localeCompare(a.effectiveFrom),
            )
            .map((x: any) => (
              <div key={x.id}>
                <div className={`face ${x.memberId}`}>
                  {s.members.find((m: any) => m.id === x.memberId)?.name[0]}
                </div>
                <p>
                  <b>{s.members.find((m: any) => m.id === x.memberId)?.name}</b>
                  <small>
                    À partir de{" "}
                    {new Date(`${x.effectiveFrom}-02`).toLocaleDateString(
                      "fr-FR",
                      { month: "long", year: "numeric" },
                    )}
                  </small>
                </p>
                <strong>{euro(x.amountCents)}</strong>
              </div>
            ))}
        </div>
      </section>
      <section className="panel page-panel usage">
        <h2>Comment utiliser BUDG ?</h2>
        <ol>
          <li>Vérifiez les revenus et leur date d’effet.</li>
          <li>
            Préparez les enveloppes du mois : chaque ligne choisit 50/50 ou
            prorata.
          </li>
          <li>Consultez la contribution calculée de chaque membre.</li>
          <li>Enregistrez les versements sur le compte commun.</li>
          <li>Ajoutez les dépenses au fil du mois.</li>
          <li>Contrôlez les enveloppes, puis clôturez le mois.</li>
          <li>Affectez ensuite le Surplus à vos projets communs.</li>
        </ol>
      </section>
    </>
  );
}
function MobileNav({ view, go, add }: any) {
  return (
    <nav className="mobile-nav">
      {(["dashboard", "budget", "add", "surplus", "settings"] as const).map(
        (id) =>
          id === "add" ? (
            <button className="mobile-add" key={id} onClick={add}>
              <Plus />
              <span>Sortie</span>
            </button>
          ) : (
            (() => {
              const n = navigation.find((x) => x[0] === id)!;
              const I = n[2];
              return (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() => go(id)}
                >
                  <I />
                  <span>{id === "dashboard" ? "Accueil" : n[1]}</span>
                </button>
              );
            })()
          ),
      )}
    </nav>
  );
}
function Modal({ title, close, children }: any) {
  return (
    <div className="overlay" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={close}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({
  label,
  name,
  placeholder,
  type = "text",
  value,
  required = true,
}: any) {
  return (
    <label>
      {label}
      <input
        autoFocus={name === "amount" || name === "name"}
        name={name}
        placeholder={placeholder}
        type={type}
        defaultValue={value}
        required={required}
      />
    </label>
  );
}
