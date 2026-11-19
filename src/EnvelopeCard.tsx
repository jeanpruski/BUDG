import { useState } from "react";
import { Sprout, ReceiptText, ShoppingBag } from "lucide-react";
import { Budget, budgetSummary, envelopeMonthFinished, euro, keepsReserve, today } from "./domain";
import type { Actions } from "./screens";
import { EnvelopePopup } from "./EnvelopePopup";
import "./envelope-disclosure.css";

export type EnvelopeLine = ReturnType<typeof budgetSummary>["lines"][number];
export function envelopePresentation(line: EnvelopeLine, budget: Budget) {
  const late = line.kind === "FIXED" && !keepsReserve(line) && line.capacity > 0 && !line.settled && line.dueDay &&
    `${budget.id}-${String(Math.min(line.dueDay, new Date(Number(budget.id.slice(0, 4)), Number(budget.id.slice(5)), 0).getDate())).padStart(2, "0")}` < today();
  const finished = !!line.billClosure || envelopeMonthFinished(line);
  const label = finished ? "Clôturé" : keepsReserve(line)
    ? line.kind === "FIXED" ? "Report conservé" : "Réserve"
    : line.kind === "VARIABLE" ? "À consommer"
    : line.settled ? "Facture réglée" : line.capacity === 0 ? "Rien à financer ce mois" : late ? "Échéance dépassée" : "Facture à régler";
  const tone = finished ? "green" : keepsReserve(line) ? "blue" : line.settled ? "green" : late ? "amber" : "";
  const Icon = keepsReserve(line) ? Sprout : line.kind === "FIXED" ? ReceiptText : ShoppingBag;
  return { finished, label, tone, Icon };
}
export function EnvelopeCard({ budget, line, actions, readOnly, compact, potAvailableCents }: {
  budget: Budget; line: EnvelopeLine; actions: Actions; readOnly: boolean; compact: boolean; potAvailableCents: number;
}) {
  const [open, setOpen] = useState(false);
  const { finished, label, tone, Icon } = envelopePresentation(line, budget);
  return <article className={`panel envelope envelope-${line.kind.toLowerCase()}${finished ? " envelope-closed" : ""}`}>
    <button type="button" className="envelope-card-trigger" aria-haspopup="dialog"
      aria-label={`Ouvrir l’enveloppe · ${line.name}`} onClick={() => setOpen(true)}>
      <span className="section-head">
        <span className="envelope-title"><span className="envelope-symbol"><Icon size={19} aria-hidden="true" /></span><span className="envelope-name">{line.name}</span></span>
        <span className={`badge ${tone}`}>{label}</span>
      </span>
      <span className="envelope-amount"><strong className={line.available < 0 ? "text-red" : undefined}>{euro(line.available)}</strong>
        <span>{budget.status === "CLOSED" ? "solde de l’enveloppe à la clôture" : "financés, encore disponibles"}</span></span>
      <progress aria-label={`Dépenses ${line.name}`} value={Math.min(line.spent, line.capacity || 1)} max={line.capacity || 1} />
      <span className="envelope-usage"><span>{euro(line.spent)} payés</span><span>Budget {euro(line.capacity)}</span></span>
    </button>
    {open && <EnvelopePopup budget={budget} line={line} actions={actions} readOnly={readOnly} compact={compact}
      potAvailableCents={potAvailableCents} close={() => setOpen(false)} presentation={{ label, tone, Icon }} />}
  </article>;
}
