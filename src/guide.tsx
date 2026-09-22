import { useState } from "react";
import { ArrowRight, CheckCircle2, Compass, Sparkles } from "lucide-react";
import {
  AppState,
  BudgetLine,
  budgetSummary,
  euro,
  parseMoney,
} from "./domain";
import { Field, Form } from "./ui";
import { Actions } from "./screens";

export function BudgetGuide({
  state,
  actions,
  prepare,
  payments,
}: {
  state: AppState;
  actions: Actions;
  prepare: () => void;
  payments: () => void;
}) {
  const b = state.budget;
  const summary = budgetSummary(b);
  const prepared = summary.plannedCents > 0;
  const funded = prepared && summary.missingCents === 0;
  const closed = b.status === "CLOSED";
  const steps = [
    { label: "Votre duo", done: true },
    { label: "Vos enveloppes", done: prepared },
    { label: "Les versements", done: funded },
    { label: "Le bilan", done: closed },
  ];
  const completed = steps.filter((s) => s.done).length;
  return (
    <section className="budget-guide" aria-label="Votre guide du mois">
      <div className="section-head">
        <div>
          <span className="eyebrow">
            <Compass size={14} /> VOTRE PETIT RITUEL
          </span>
          <h2>
            {closed
              ? "Un mois de plus, ensemble !"
              : !prepared
                ? "On construit votre budget ?"
                : !funded
                  ? "Votre budget prend forme"
                  : "Les contributions sont à jour !"}
          </h2>
        </div>
        <span className="badge green">{completed} / 4 étapes</span>
      </div>
      <ol className="guide-steps">
        {steps.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : ""}>
            <span>{s.done ? <CheckCircle2 size={18} /> : i + 1}</span>
            {s.label}
          </li>
        ))}
      </ol>
      <div className="guide-next">
        <div>
          <strong>
            {closed
              ? "Prêts pour la suite ?"
              : !prepared
                ? "Votre prochaine étape : donner un rôle à votre argent"
                : !funded
                  ? `Il reste ${euro(summary.missingCents)} à recevoir sur le compte commun`
                  : "Le bon réflexe : noter les achats une fois payés"}
          </strong>
          <p>
            {closed
              ? "Le surplus reste dans votre pot commun. Au prochain mois, on vérifiera d’abord vos salaires."
              : !prepared
                ? "Je vous accompagne enveloppe par enveloppe : logement, courses, puis projets. Vous gardez la main sur chaque montant."
                : !funded
                  ? "Chacun vire sa contribution, puis vous enregistrez uniquement l’argent réellement reçu. Un budget prévu n’est pas encore de l’argent disponible."
                  : "Avant les courses, regardez le disponible financé. Après les courses, saisissez le ticket : l’enveloppe diminue automatiquement. Aucune dépense à inventer pour avancer !"}
          </p>
        </div>
        <button
          className="primary"
          onClick={
            closed
              ? actions.next
              : !prepared
                ? prepare
                : !funded
                  ? payments
                  : () => actions.expense()
          }
        >
          {closed
            ? "Préparer le prochain mois"
            : !prepared
              ? "Me guider pas à pas"
              : !funded
                ? "Voir les contributions"
                : "Noter un achat"}
          <ArrowRight size={16} />
        </button>
      </div>
      <details className="guide-help">
        <summary>Comment ça marche ? Un exemple et mes repères</summary>
        <div className="guide-lessons">
          <article>
            <h3>1. Prévoir</h3>
            <p>
              Exemple : vous prévoyez 400 € de courses. Chacun doit apporter 200
              €. Les dépenses de l’appartement suivent, elles, le prorata des
              salaires.
            </p>
          </article>
          <article>
            <h3>2. Recevoir, puis dépenser</h3>
            <p>
              Quand les deux contributions sont reçues et enregistrées, les 400
              € sont financés. Un ticket de 65 € laisse alors 335 € disponibles
              dans cette enveloppe.
            </p>
          </article>
          <article>
            <h3>3. Faire le bilan</h3>
            <p>
              En fin de mois, vérifiez les factures et les achats, puis
              clôturez. Le surplus rejoint le pot commun ; les réserves vacances
              restent affectées à votre projet.
            </p>
          </article>
        </div>
        <p className="hint">
          Ces chiffres sont un exemple, pas des opérations ajoutées à votre
          budget. BUDG ne fait aucun virement bancaire.
        </p>
        {!closed && (
          <button className="secondary" onClick={prepare}>
            Reprendre le guide des enveloppes
          </button>
        )}
      </details>
    </section>
  );
}

export function EnvelopeCoach({
  state,
  busy,
  save,
  finish,
  custom,
}: {
  state: AppState;
  busy: boolean;
  save: (line: BudgetLine, amount: number) => Promise<boolean>;
  finish: () => void;
  custom: () => void;
}) {
  const lines = state.budget.lines;
  const [index, setIndex] = useState(0);
  const [error, setError] = useState("");
  const line = lines[index];
  const summary = budgetSummary(state.budget);
  if (!line)
    return (
      <div className="coach-review">
        <Sparkles size={32} />
        <h3>Votre budget, à votre rythme</h3>
        <p>
          {summary.plannedCents > 0
            ? "Voici ce que chacun prévoit de verser sur le compte commun. Le reste du salaire reste personnel."
            : "Vous pouvez ajouter une enveloppe ou reprendre les montants quand vous êtes prêts."}
        </p>
        {state.budget.members.map((m) => (
          <div className="form-context" key={m.id}>
            <strong>{m.name}</strong>
            <p>Contribution prévue : {euro(summary.expected[m.id])}</p>
            <p>
              Reste personnel prévu :{" "}
              {euro(m.incomeCents - summary.expected[m.id])}
            </p>
            {summary.expected[m.id] > m.incomeCents && (
              <p className="alert warning">
                La contribution dépasse le salaire renseigné. Revoyez les
                montants pour un budget tenable.
              </p>
            )}
          </div>
        ))}
        <p className="hint">
          Les montants sont enregistrés. La prochaine étape sera d’enregistrer
          vos virements réellement reçus.
        </p>
        <div className="coach-controls">
          <button
            className="secondary"
            onClick={() => setIndex(0)}
            disabled={!lines.length}
          >
            Revoir les montants
          </button>
          <button className="secondary" onClick={custom}>
            Ajouter une autre enveloppe
          </button>
          <button className="primary" onClick={finish}>
            Voir mon budget
          </button>
        </div>
      </div>
    );
  return (
    <div>
      <div className="coach-progress">
        <span>
          Enveloppe {index + 1} sur {lines.length}
        </span>
        <progress
          aria-label="Progression du guide"
          value={index}
          max={lines.length}
        />
      </div>
      <div className="coach-prompt">
        <span className="eyebrow">
          {line.expenseGroup === "HOUSING"
            ? "LE COCON · AU PRORATA"
            : line.kind === "RESERVE"
              ? "LES PROJETS · À 50/50"
              : "LE QUOTIDIEN · À 50/50"}
        </span>
        <h3>{line.name}</h3>
        <p>
          {line.kind === "FIXED"
            ? "Regardez votre dernière facture ou votre mensualité. Quel montant faut-il prévoir chaque mois ? Vous pourrez ajuster ensuite."
            : line.kind === "RESERVE"
              ? "Combien voulez-vous mettre de côté chaque mois pour ce projet ? Par exemple, un objectif de 600 € dans 6 mois correspond à 100 € par mois."
              : "Combien souhaitez-vous prévoir pour le mois ? Vos derniers tickets peuvent vous aider. Une estimation suffit pour commencer."}
        </p>
      </div>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <Form
        key={line.id}
        busy={busy}
        button="Enregistrer et continuer"
        submit={(data) => {
          setError("");
          try {
            const amount = parseMoney(data.get("amount"), true);
            void save(line, amount).then((ok) => {
              if (ok) setIndex(index + 1);
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Vérifiez le montant.");
          }
        }}
      >
        <Field
          label="Montant prévu par mois (€)"
          name="amount"
          value={line.plannedCents ? line.plannedCents / 100 : ""}
          placeholder="Votre estimation"
        />
        <p className="hint">
          0 € est possible si vous ne prévoyez rien pour cette enveloppe.
          Enregistrer ce montant ne crée ni versement ni dépense.
        </p>
      </Form>
      <div className="coach-controls">
        <button
          className="secondary"
          disabled={busy || index === 0}
          onClick={() => {
            setError("");
            setIndex(index - 1);
          }}
        >
          Précédent
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            setIndex(index + 1);
          }}
        >
          Garder {euro(line.plannedCents)} et continuer
        </button>
      </div>
      <p className="hint">
        Chaque montant enregistré est conservé. Vous pouvez fermer et reprendre
        le guide plus tard.
      </p>
    </div>
  );
}
