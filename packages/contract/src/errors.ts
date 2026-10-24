// Каталог ошибок (ADR-0005, ARCHITECTURE §9): код → HTTP-статус и повторяемость. Ответ сервера —
// `{ code, status, data: { requestId, params } }`; текст для человека пишет сайт или бот по коду через словарь errors
// (@kosht/i18n), поэтому здесь только параметры для подстановки. Новый код — сюда и текст в errors одним коммитом.
import { z } from "zod";

interface ErrorDef {
  readonly status: number;
  /** Повтор того же запроса может пройти (лимит частоты, временная недоступность): обёртка задачи повторяет. */
  readonly retryable: boolean;
}

export const ERRORS = {
  /** Вход не прошёл схему контракта. */
  VALIDATION: { status: 400, retryable: false },
  /** Нет сессии: нужно войти. */
  UNAUTHORIZED: { status: 401, retryable: false },
  /** Вход есть, а права нет (админка, «только с этого компьютера»). */
  FORBIDDEN: { status: 403, retryable: false },
  /** Записи нет — и для чужой записи тоже (ADR-0005): так не узнать, что она существует. */
  NOT_FOUND: { status: 404, retryable: false },
  /** Состояние уже изменилось: дубликат, устаревшая версия. */
  CONFLICT: { status: 409, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  /** Всё непредвиденное: наружу без текста исключения, стек — в лог. */
  INTERNAL: { status: 500, retryable: false },
  /** Временно недоступна зависимость (модель, БД, внешний сервис). */
  UNAVAILABLE: { status: 503, retryable: true },
} as const satisfies Record<string, ErrorDef>;

/** Код ошибки из каталога; другого кода процедура объявить не может. */
export type ErrorCode = keyof typeof ERRORS;

function isErrorCode(key: string): key is ErrorCode {
  return Object.hasOwn(ERRORS, key);
}

/** Все коды каталога в порядке объявления. */
export const ERROR_CODES: readonly ErrorCode[] = Object.keys(ERRORS).filter(isErrorCode);

export function isRetryable(code: ErrorCode): boolean {
  return ERRORS[code].retryable;
}

/** Параметры для подстановки в текст ошибки: `t("errors:CONFLICT", params)`; объектов и текста исключений нет. */
export const ErrorParams = z.record(
  z.string().max(64),
  z.union([z.string().max(1000), z.number(), z.boolean()]),
);

/** Данные любой ошибки: `requestId` связывает ответ с записью в логе (OBS-02). */
export const ErrorData = z.strictObject({
  requestId: z.string().min(1).max(128),
  params: ErrorParams,
});

type PickedErrors<C extends ErrorCode> = {
  readonly [K in C]: {
    readonly status: (typeof ERRORS)[K]["status"];
    readonly data: typeof ErrorData;
  };
};

/** Карта ошибок для `.errors(...)` процедуры: статус — из каталога, данные — `ErrorData`. */
export function pickErrors<const C extends readonly ErrorCode[]>(
  ...codes: C
): PickedErrors<C[number]> {
  const entries = codes.map((code) => {
    // Тип не пускает чужой код, но JS-вызов или `as` — пустят: такая карта ошибок молча сломала бы ответ.
    if (!isErrorCode(code)) {
      throw new RangeError(
        `Кода ошибки «${String(code)}» нет в каталоге: добавьте его в errors.ts.`,
      );
    }
    return [code, { status: ERRORS[code].status, data: ErrorData }];
  });
  // Object.fromEntries теряет связь ключа и значения в типе; ключи — ровно codes, значения собраны выше.
  return Object.fromEntries(entries) as PickedErrors<C[number]>;
}
