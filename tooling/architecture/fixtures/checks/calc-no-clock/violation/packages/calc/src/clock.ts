export function today() {
  return new Date();
}
export const stamp = () => Date.now();
export const pick = () => Math.random();
export const money = new Intl.NumberFormat("ru-BY");
export const started = performance.now();
export const id = crypto.randomUUID();
export const later = new Date;
export const instant = Temporal.Now.instant();
