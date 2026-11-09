import { useState } from "react";
import { ArrowDownLeft, Sprout, Wallet } from "lucide-react";
import { AppState, euro } from "./domain";
import { monthOverview } from "./monthOverview";
import { Metric } from "./ui";
import "./overview.css";

const categoryColors = {
  housing: "#245947",
  daily: "#94ad87",
  pot: "#c6a566",
  reserve: "#6c94b1",
};

export function Dashboard({ state }: { state: AppState }) {
  const [showReserves, setShowReserves] = useState(true);
  const overview = monthOverview(state);
  const provisions = overview.reserveProvisions;
  const categories = showReserves
    ? [...overview.categories, { key: "reserve" as const, label: "Réserves du mois", cents: overview.retainedReserveCents }]
    : overview.categories;
  const totalCents = overview.spentCents + (showReserves ? overview.retainedReserveCents : 0);
  const totalLabel = euro(totalCents);
  let offset = 0;
  const segments = categories.map((category) => {
    const percent = totalCents > 0
      ? category.cents / totalCents * 100
      : 0;
    const segment = { ...category, percent, offset };
    offset += percent;
    return segment;
  });

  return (
    <div className="overview">
      <div className="overview-monthly">
      <figure className="overview-spending" aria-labelledby="overview-spending-title">
        <figcaption className="overview-heading overview-chart-heading">
          <div>
            <span className="eyebrow">EN UN COUP D’ŒIL</span>
            <h2 id="overview-spending-title">Répartition du mois</h2>
          </div>
          <button
            type="button"
            className="overview-reserve-toggle"
            aria-pressed={showReserves}
            onClick={() => setShowReserves((value) => !value)}
          >
            <span className="overview-toggle-track" aria-hidden="true"><span /></span>
            Réserves du mois
          </button>
        </figcaption>
        <div className="overview-chart-content">
          <div className="overview-donut">
            <svg viewBox="0 0 240 240" aria-hidden="true" focusable="false">
              <circle cx="120" cy="120" r="90" fill="none" stroke="#e9eee5" strokeWidth="28" />
              <g transform="rotate(-90 120 120)">
                {segments.filter((segment) => segment.percent > 0).map((segment) => (
                  <circle
                    key={segment.key}
                    cx="120" cy="120" r="90"
                    fill="none"
                    stroke={categoryColors[segment.key]}
                    strokeWidth="28"
                    pathLength="100"
                    strokeDasharray={`${segment.percent} ${100 - segment.percent}`}
                    strokeDashoffset={-segment.offset}
                  />
                ))}
              </g>
            </svg>
            <div className="overview-chart-total">
              <span>{showReserves ? "Payé et réservé" : "Dépenses payées"}</span>
              <strong className={totalLabel.length > 12 ? "compact" : undefined}>{totalLabel}</strong>
            </div>
          </div>
          <div className="overview-breakdown">
            <dl className="overview-legend">
              {categories.map((category) => (
                <div key={category.key}>
                  <dt>
                    <span className="overview-swatch" style={{ background: categoryColors[category.key] }} aria-hidden="true" />
                    {category.label}
                  </dt>
                  <dd>{euro(category.cents)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className="overview-chart-note">
          {showReserves
            ? "Les réserves montrent la part provisionnée ce mois encore disponible, hors reports et renforts du pot. Les sommes déjà dépensées restent dans les paiements."
            : "Les réserves du mois sont masquées. Seuls les paiements réels sont affichés."}
        </p>
        {totalCents === 0 && <p className="overview-chart-note">{showReserves ? "Aucun paiement ni nouvelle réserve disponible ce mois-ci." : "Aucune dépense enregistrée ce mois-ci."}</p>}
      </figure>
      <section className="overview-savings" aria-labelledby="overview-savings-title">
        <div className="overview-savings-heading">
          <Sprout size={20} aria-hidden="true" />
          <h2 id="overview-savings-title">Mis de côté ce mois</h2>
        </div>
        <strong className="overview-savings-total">{euro(provisions.fundedCents)}</strong>
        <p className="overview-savings-note">Provisions financées par les versements de ce mois, hors reports et transferts du pot.</p>
        {provisions.lines.length > 0 ? (
          <table className="overview-savings-breakdown" aria-label="Réserves par enveloppe">
            <thead><tr><th scope="col">Enveloppe</th><th scope="col">Ce mois</th><th scope="col">Total disponible</th></tr></thead>
            <tbody>{provisions.lines.map((line) => <tr key={line.id}>
              <th scope="row">{line.name}</th>
              <td className={euro(line.fundedCents).length > 12 ? "compact" : undefined}>{euro(line.fundedCents)}</td>
              <td className={`${line.availableCents < 0 ? "text-red" : ""} ${euro(line.availableCents).length > 12 ? "compact" : ""}`.trim() || undefined}>{euro(line.availableCents)}</td>
            </tr>)}</tbody>
          </table>
        ) : (
          <p className="overview-savings-empty">Aucune enveloppe Réserve pour ce mois.</p>
        )}
        <div className="overview-reserve-balance">
          <dl><div><dt>Réserves disponibles</dt><dd className={provisions.availableCents < 0 ? "text-red" : undefined}>{euro(provisions.availableCents)}</dd></div></dl>
          <p>Avec les reports et les renforts du pot, après les dépenses.</p>
        </div>
      </section>
      </div>
      <div className="metrics two overview-context">
        <Metric
          icon={Wallet}
          label="Solde du compte commun"
          value={euro(overview.accountBalanceCents)}
          tone={overview.accountBalanceCents < 0 ? "amber" : "green"}
        />
        <Metric
          icon={ArrowDownLeft}
          label="Encore à verser ce mois"
          value={euro(overview.missingCents)}
          detail={overview.missingCents > 0 ? "Contributions et compléments attendus" : "Aucun versement attendu"}
          tone={overview.missingCents > 0 ? "amber" : ""}
        />
      </div>
    </div>
  );
}
