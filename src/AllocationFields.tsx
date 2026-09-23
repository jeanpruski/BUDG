import { useEffect, useRef, useState } from "react";
import {
  AllocationType,
  BudgetLine,
  Member,
  euro,
  parseMoney,
  sharesFor,
} from "./domain";
export function readAllocation(data: FormData, members: Member[]) {
  const allocationType = String(data.get("allocationType")) as AllocationType;
  return {
    allocationType,
    customPercentages:
      allocationType === "CUSTOM"
        ? members.map((m) => ({
            memberId: m.id,
            percent: Number(
              String(data.get(`percent-${m.id}`)).replace(",", "."),
            ),
          }))
        : undefined,
  };
}
export function AllocationFields({
  members,
  line,
  defaultType,
}: {
  members: Member[];
  line?: BudgetLine;
  defaultType: AllocationType;
}) {
  const [type, setType] = useState<AllocationType>(
    line?.allocationType ?? defaultType,
  );
  const [first, setFirst] = useState(
    String(
      line?.customPercentages?.find((p) => p.memberId === members[0].id)
        ?.percent ?? 50,
    ),
  );
  const [amount, setAmount] = useState(line?.plannedCents ?? 0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const update = () => {
      try {
        setAmount(parseMoney(new FormData(form!).get("amount"), true));
      } catch {
        setAmount(0);
      }
    };
    update();
    form?.addEventListener("input", update);
    return () => form?.removeEventListener("input", update);
  }, []);
  const percent = Number(first.replace(",", "."));
  const valid =
    first.trim() !== "" &&
    Number.isFinite(percent) &&
    percent >= 0 &&
    percent <= 100;
  const second = valid ? Math.round((100 - percent) * 100) / 100 : 0;
  let parts: ReturnType<typeof sharesFor> = [];
  try {
    if (type !== "CUSTOM" || valid)
      parts = sharesFor(amount, type, members, [
        { memberId: members[0].id, percent },
        { memberId: members[1].id, percent: second },
      ]);
  } catch {
    /* Invalid form values are validated on submit. */
  }
  return (
    <div ref={ref} className="allocation-fields">
      <label className="field">
        Répartition entre vous
        <select
          name="allocationType"
          value={type}
          onChange={(e) => setType(e.target.value as AllocationType)}
        >
          <option value="FIFTY_FIFTY">50/50 — parts égales</option>
          <option value="PRO_RATA">Selon vos salaires</option>
          <option value="CUSTOM">
            Personnalisée — je choisis les pourcentages
          </option>
        </select>
      </label>
      {type === "CUSTOM" && (
        <div className="form-grid">
          <label className="field">
            {members[0].name} (%)
            <input
              name={`percent-${members[0].id}`}
              type="number"
              min="0"
              max="100"
              step="0.01"
              required
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
          </label>
          <label className="field">
            {members[1].name} (%)
            <input
              name={`percent-${members[1].id}`}
              type="number"
              readOnly
              value={second}
            />
          </label>
          <p className="hint">
            La seconde part se complète automatiquement pour totaliser 100 %.
          </p>
        </div>
      )}
      <div className="form-context" aria-live="polite">
        {parts.map((p) => (
          <p key={p.memberId}>
            <strong>{members.find((m) => m.id === p.memberId)?.name}</strong> :{" "}
            {euro(p.amountCents)} / mois
          </p>
        ))}
      </div>
      {line && (
        <p className="hint">
          Un changement recalcule les parts du mois ouvert, y compris pour les
          achats déjà saisis. Les mois clôturés et les réserves déjà reportées
          conservent leurs parts.
        </p>
      )}
    </div>
  );
}
