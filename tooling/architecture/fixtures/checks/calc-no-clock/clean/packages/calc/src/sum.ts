export function sum(parts: readonly number[]): number {
  return parts.reduce((total, part) => total + part, 0);
}
