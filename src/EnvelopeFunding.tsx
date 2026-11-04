import { budgetSummary, euro } from "./domain";
import "./pot-transfers.css";

export function EnvelopeFunding({ line }: {
  line: ReturnType<typeof budgetSummary>["lines"][number];
}) {
  return (
    <div className="envelope-funding">
      <dl>
        <div><dt>Provision du mois</dt><dd>{euro(line.plannedCents)}</dd></div>
        {line.kind === "RESERVE" && <div><dt>Réserve reportée</dt><dd>{euro(line.opening)}</dd></div>}
        {line.potAddedCents > 0 && <div><dt>Depuis le pot ce mois</dt><dd>{euro(line.potAddedCents)}</dd></div>}
        <div><dt>Dépensé</dt><dd>{euro(line.spent)}</dd></div>
      </dl>
      {line.funded < line.capacity && <p className="text-amber">Encore à financer : {euro(line.capacity - line.funded)}</p>}
      {line.remaining < 0 && <p className="text-red">Dépassement du prévu : {euro(-line.remaining)}</p>}
    </div>
  );
}
