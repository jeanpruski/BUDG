/** The same vector mark on every BUDG screen. The adjacent name labels it. */
export function BrandMark({ size = 38 }: { size?: number }) {
  return <img src="/assets/budg-mark.svg" alt="" width={size} height={size} />;
}
