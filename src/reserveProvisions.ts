import type { budgetSummary } from "./domain";

/** Personal provisions received this month, kept separate from spending and reserve stock. */
export function monthlyReserveProvisions(summary: ReturnType<typeof budgetSummary>) {
  const reserves = summary.lines.filter((line) => line.kind === "RESERVE");
  const lines = reserves.map((line) => ({
    id: line.id,
    name: line.name,
    availableCents: line.available,
    fundedCents: line.fundedShares.reduce((total, funded) => {
      const planned = line.shares.find((share) => share.memberId === funded.memberId)?.amountCents ?? 0;
      return total + Math.min(Math.max(0, funded.amountCents), planned);
    }, 0),
  }));
  return {
    fundedCents: lines.reduce((total, line) => total + line.fundedCents, 0),
    availableCents: lines.reduce((total, line) => total + line.availableCents, 0),
    lines,
  };
}
