// TAX-02: правило расчёта по типу занятости (PROF-01: типов может быть несколько сразу — зарплата + НПД). Чистая функция.
import type { DeductionFlag, EmploymentType } from "@kosht/contract";

export type EmploymentMode = "employee" | "ip" | "npd-only";

export interface EmploymentRule {
  readonly mode: EmploymentMode;
  readonly flags: readonly DeductionFlag[];
}

/**
 * Приоритет: наёмный работник > ИП > НПД. «Только НПД» без зарплаты — вычетов нет (`npd-only`); НПД с зарплатой — расчёт по
 * зарплате. ИП без найма — вычеты через декларацию. `hasSalary` — названа ли зарплата (вход, факт профиля).
 */
export function classifyEmployment(
  types: readonly EmploymentType[] | null,
  hasSalary: boolean,
): EmploymentRule {
  const set = new Set(types ?? []);
  if (set.has("employee")) {
    return { mode: "employee", flags: set.has("npd") ? ["npd-with-salary"] : [] };
  }
  if (set.has("ip")) return { mode: "ip", flags: ["ip-declaration"] };
  if (set.has("npd")) {
    return hasSalary
      ? { mode: "employee", flags: ["npd-with-salary"] }
      : { mode: "npd-only", flags: [] };
  }
  return { mode: "employee", flags: [] };
}
