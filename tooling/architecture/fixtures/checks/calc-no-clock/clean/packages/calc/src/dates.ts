// Сегодня приходит аргументом: здесь нет ни Date.now(), ни Math.random(), ни Intl.
export function dayOf(iso: string): Date {
  return new Date(iso);
}
export const parse = (s: string) => Date.parse(s);
export const epoch = Date.UTC(2026, 0, 1);
export const hint = "new Date() и Math.random() — только в строке";
