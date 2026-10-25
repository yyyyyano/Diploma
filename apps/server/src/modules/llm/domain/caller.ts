// Кто зовёт модель (PRIV-02, PRIV-09, ARCHITECTURE §8.1): пользователь — его scope (цепочка учитывает облачное
// согласие), задача без данных пользователя (темы новых актов, сверка ставок) — systemCaller модуля: облачная
// цепочка разрешена, потому что пользовательских данных в запросе нет.
import type { Scope } from "@kosht/kernel";

declare const SYSTEM_CALLER: unique symbol;

/** Вызов без данных пользователя от имени модуля; литералом не собрать — только systemCaller(). */
export interface SystemCaller {
  readonly kind: "system";
  readonly module: string;
  readonly [SYSTEM_CALLER]: true;
}

export type Caller = Scope | SystemCaller;

const MODULE_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function systemCaller(module: string): SystemCaller {
  if (!MODULE_ID.test(module)) throw new RangeError(`systemCaller: «${module}» — не id модуля.`);
  return { kind: "system", module } as SystemCaller;
}

export function isSystemCaller(caller: Caller): caller is SystemCaller {
  return "kind" in caller && caller.kind === "system";
}
