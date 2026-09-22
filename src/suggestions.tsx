import { BudgetLine } from "./domain";

export const envelopeSuggestions = [
  {
    name: "Taxe d’habitation",
    expenseGroup: "HOUSING",
    kind: "RESERVE",
    hint: "Si elle vous concerne : mettez de côté une part chaque mois, puis saisissez le paiement réel à son échéance.",
  },
  {
    name: "Charges de copropriété",
    expenseGroup: "HOUSING",
    kind: "RESERVE",
    hint: "Pour des appels de charges trimestriels ou annuels. Si vous payez chaque mois, choisissez le fonctionnement Facture.",
  },
  {
    name: "Box internet",
    expenseGroup: "HOUSING",
    kind: "FIXED",
    hint: "La mensualité de la connexion de l’appartement, répartie au prorata des salaires.",
  },
  {
    name: "Eau",
    expenseGroup: "HOUSING",
    kind: "RESERVE",
    hint: "Pour préparer une facture périodique, si elle n’est pas déjà incluse dans les charges.",
  },
  {
    name: "Gaz / chauffage",
    expenseGroup: "HOUSING",
    kind: "FIXED",
    hint: "Votre mensualité, uniquement si elle n’est pas déjà comprise dans l’électricité ou les charges.",
  },
  {
    name: "Taxe foncière",
    expenseGroup: "HOUSING",
    kind: "RESERVE",
    hint: "Si elle vous concerne : une provision mensuelle pour préparer le paiement.",
  },
  {
    name: "Entretien de l’appartement",
    expenseGroup: "HOUSING",
    kind: "RESERVE",
    hint: "Une réserve pour les réparations et le remplacement d’équipements.",
  },
  {
    name: "Sorties à deux",
    expenseGroup: "DAILY_LIFE",
    kind: "VARIABLE",
    hint: "Restaurants, cinéma et petits plaisirs communs, à 50/50.",
  },
  {
    name: "Abonnements communs",
    expenseGroup: "DAILY_LIFE",
    kind: "FIXED",
    hint: "Les abonnements utilisés à deux, à 50/50.",
  },
  {
    name: "Transport commun",
    expenseGroup: "DAILY_LIFE",
    kind: "VARIABLE",
    hint: "Les trajets et le carburant partagés, à 50/50.",
  },
] as const;
export function EnvelopeSuggestions({
  lines,
  choose,
}: {
  lines: BudgetLine[];
  choose: (line: BudgetLine) => void;
}) {
  const available = envelopeSuggestions.filter(
    (s) =>
      !lines.some(
        (l) =>
          l.name.toLocaleLowerCase("fr") === s.name.toLocaleLowerCase("fr"),
      ),
  );
  if (!available.length) return null;
  return (
    <section className="panel">
      <h2>On n’a rien oublié ?</h2>
      <p>
        Choisissez les dépenses qui vous concernent. Vérifiez le montant avant
        d’ajouter : aucun paiement n’est créé.
      </p>
      <div className="guide-lessons">
        {available.map((s) => (
          <article key={s.name}>
            <h3>{s.name}</h3>
            <p>{s.hint}</p>
            <button
              className="secondary"
              onClick={() =>
                choose({
                  ...s,
                  id: "",
                  plannedCents: 0,
                  shares: [],
                  openingShares: [],
                  settled: false,
                  allocationType:
                    s.expenseGroup === "HOUSING" ? "PRO_RATA" : "FIFTY_FIFTY",
                })
              }
            >
              Préparer cette enveloppe
            </button>
          </article>
        ))}
      </div>
      <p className="hint">
        Une réserve garde son solde d’un mois à l’autre. Exemple : 1 200 € à
        payer dans 12 mois → 100 € à réserver par mois. Si l’échéance est plus
        proche, adaptez au nombre de mois restants et à l’argent déjà réservé.
        Si vous êtes déjà prélevés mensuellement, choisissez « Facture » pour
        éviter de compter deux fois la même dépense.
      </p>
    </section>
  );
}
