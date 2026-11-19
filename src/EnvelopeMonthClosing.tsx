import { CheckCircle2 } from "lucide-react";
import { Budget, budgetSummary, envelopeFullyFunded, envelopeMonthFinished, euro, keepsReserve } from "./domain";
import type { Actions } from "./screens";
import "./bill-closing.css";

export function EnvelopeMonthClosing({ budget, line, actions, readOnly = false }: {
  budget: Budget; line: ReturnType<typeof budgetSummary>["lines"][number]; actions: Actions; readOnly?: boolean;
}) {
  if (!["RESERVE", "FIXED"].includes(line.kind) || line.billClosure) return null;
  const editable = !readOnly && budget.status === "ACTIVE";
  const finished = envelopeMonthFinished(line);
  if (!finished && !editable) return null;
  return <div className="bill-closing">
    {finished ? <>
      <p className="bill-closed-status"><CheckCircle2 size={16} aria-hidden="true" />Terminé pour ce mois</p>
      <p>{euro(Math.max(0, line.available))} conservés dans cette enveloppe. La prochaine provision reste due en totalité.</p>
      {editable && actions.reopenEnvelopeMonth && <button type="button" className="text-button"
        onClick={() => actions.reopenEnvelopeMonth?.(line.id)} aria-label={`Rouvrir le suivi du mois · ${line.name}`}>Rouvrir le suivi du mois</button>}
    </> : actions.finishEnvelopeMonth && <>
      <button type="button" className="secondary full" disabled={!envelopeFullyFunded(line)}
        onClick={() => actions.finishEnvelopeMonth?.(line.id)} aria-label={`Terminer pour ce mois · ${line.name}`}>Terminer pour ce mois</button>
      <p>{keepsReserve(line) ? "Le solde reste dans cette enveloppe pour les prochains mois." : "Reporter le solde dans cette enveloppe, sans paiement ni transfert au pot."}</p>
      {!envelopeFullyFunded(line) && <p>La provision du mois doit être entièrement financée.</p>}
    </>}
  </div>;
}
