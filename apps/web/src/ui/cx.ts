/** Имена классов через пробел; ложные значения пропускаются: cx(classes.badge, active && classes.on). */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
