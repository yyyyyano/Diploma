export function Money({ value }: { value: MoneyValue }) {
  return <span className="money">{formatMoney(value)}</span>;
}
