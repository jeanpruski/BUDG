import { ArrowDownLeft, Wallet } from "lucide-react";
import { AppState, euro } from "./domain";
import { monthOverview } from "./monthOverview";
import { Metric } from "./ui";
import "./overview.css";

const categoryColors = {
  housing: "#245947",
  daily: "#94ad87",
  pot: "#c6a566",
};

export function Dashboard({ state }: { state: AppState }) {
  const overview = monthOverview(state);
  const totalLabel = euro(overview.spentCents);
  let offset = 0;
  const segments = overview.categories.map((category) => {
    const percent = overview.spentCents > 0
      ? category.cents / overview.spentCents * 100
      : 0;
    const segment = { ...category, percent, offset };
    offset += percent;
    return segment;
  });

  return (
    <div className="overview">
      <figure className="overview-spending" aria-labelledby="overview-spending-title">
        <figcaption className="overview-heading">
          <span className="eyebrow">EN UN COUP D’ŒIL</span>
          <h2 id="overview-spending-title">Les dépenses du mois</h2>
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
              <span>Total dépensé</span>
              <strong className={totalLabel.length > 12 ? "compact" : undefined}>{totalLabel}</strong>
            </div>
          </div>
          <div className="overview-breakdown">
            <dl className="overview-legend">
              {overview.categories.map((category) => (
                <div key={category.key}>
                  <dt>
                    <span className="overview-swatch" style={{ background: categoryColors[category.key] }} aria-hidden="true" />
                    {category.label}
                  </dt>
                  <dd>{euro(category.cents)}</dd>
                </div>
              ))}
            </dl>
            {overview.spentCents === 0 && (
              <p className="overview-chart-note">Aucune dépense enregistrée ce mois-ci.</p>
            )}
          </div>
        </div>
      </figure>
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
