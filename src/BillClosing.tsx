import { CheckCircle2, LockKeyhole } from "lucide-react";
import { Budget, budgetSummary, euro } from "./domain";
import type { Actions } from "./screens";
import { Form } from "./ui";
import "./bill-closing.css";

type LineSummary = ReturnType<typeof budgetSummary>["lines"][number];
export const activeBillClosure = (budget: Budget, lineId: string) =>
  budget.billClosures.find((closure) => closure.lineId === lineId && !closure.reopened);
const missingBillFunding = (line: LineSummary) => Math.max(0, Math.max(line.capacity, line.spent) - line.funded);

export function BillClosing({ budget, line, actions, readOnly = false, potAvailableCents }: {
  budget: Budget;
  line: LineSummary;
  actions: Actions;
  readOnly?: boolean;
  potAvailableCents: number;
}) {
  if (line.kind !== "FIXED") return null;
  const closure = activeBillClosure(budget, line.id);
  if (!closure && line.capacity === 0 && line.spent === 0) return null;
  const editable = !readOnly && budget.status === "ACTIVE";
  if (!closure && !editable) return null;
  const missing = missingBillFunding(line);
  return (
    <div className="bill-closing">
      {closure ? (
        <>
          <p className="bill-closed-status"><CheckCircle2 size={16} aria-hidden="true" />Facture clôturée</p>
          <p>{euro(closure.amountCents)} versés au pot commun.</p>
          {editable && actions.reopenBill && <button type="button" className="text-button"
            onClick={() => actions.reopenBill?.(line.id)} aria-label={`Rouvrir la facture · ${line.name}`}>
            Rouvrir la facture
          </button>}
          {editable && potAvailableCents < closure.amountCents && <p className="hint">Le pot doit contenir {euro(closure.amountCents)} pour la rouvrir.</p>}
        </>
      ) : actions.closeBill && (
        <>
          <button type="button" className="secondary full" disabled={missing > 0}
            onClick={() => actions.closeBill?.(line.id)} aria-label={`Clôturer la facture · ${line.name}`}>
            <LockKeyhole size={15} aria-hidden="true" /> Clôturer la facture
          </button>
          {missing > 0 && <p>Encore {euro(missing)} à financer avant de clôturer cette facture.</p>}
        </>
      )}
    </div>
  );
}

export function BillCloseForm({ line, busy, submit }: {
  line: LineSummary;
  busy: boolean;
  submit: () => void;
}) {
  const missing = missingBillFunding(line);
  const surplus = Math.max(0, line.available);
  return (
    <div className="bill-close-form">
      <p>Vérifiez que tous les paiements de cette facture sont enregistrés. Son surplus sera disponible immédiatement dans le pot commun.</p>
      <dl className="bill-close-amounts">
        <div><dt>Provision prévue</dt><dd>{euro(line.plannedCents)}</dd></div>
        <div><dt>Réellement financé</dt><dd>{euro(line.funded)}</dd></div>
        <div><dt>Déjà payé</dt><dd>{euro(line.spent)}</dd></div>
        <div><dt>Surplus vers le pot</dt><dd>{euro(surplus)}</dd></div>
      </dl>
      {missing > 0 && <p className="alert warning">Il reste {euro(missing)} à financer avant de clôturer cette facture.</p>}
      <Form busy={busy} canSubmit={missing === 0} submit={submit} button="Clôturer la facture">
        <label className="checkbox">
          <input type="checkbox" name="confirmed" required />
          Tous les paiements sont enregistrés et il ne reste rien à régler pour cette facture.
        </label>
        <p className="hint">Les paiements, la provision et sa répartition seront figés pour ce mois. Vous pourrez rouvrir la facture pour les corriger, si son surplus est disponible dans le pot.</p>
      </Form>
    </div>
  );
}

export function BillReopenForm({ amountCents, potAvailableCents, busy, submit }: {
  amountCents: number;
  potAvailableCents: number;
  busy: boolean;
  submit: () => void;
}) {
  return (
    <div className="bill-close-form">
      <p>Le surplus de <strong>{euro(amountCents)}</strong> sera repris du pot commun. Vous pourrez ensuite corriger les paiements et la provision de la facture. Sa répartition suivra les salaires et la règle actuels.</p>
      <p>Pot commun disponible : <strong>{euro(potAvailableCents)}</strong>.</p>
      {potAvailableCents < amountCents && <p className="alert warning">Le pot ne contient plus assez pour reprendre ce surplus. Rétablissez d’abord les fonds nécessaires.</p>}
      <Form busy={busy} canSubmit={potAvailableCents >= amountCents} submit={submit} button="Rouvrir la facture" children={null} />
    </div>
  );
}
