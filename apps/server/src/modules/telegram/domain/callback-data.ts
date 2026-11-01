// Данные кнопок (TG-03, TG-04, NOTIF-05): Telegram даёт на `callback_data` 64 байта, поэтому — короткий вид действия и один
// uuid сущности (2 + 36 = 38 байт). Больше в кнопке ничего нет: «чьё» это, решает scope из привязки чата, а владелец
// сущности проверяется через `s` в сценарии (чужой id — NOT_FOUND, SEC-04).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const CALLBACK_ACTIONS = {
  "receipt-confirm": "rk",
  "receipt-edit": "re",
  "receipt-cancel": "rx",
  "statement-import": "si",
  "statement-cancel": "sx",
  "decision-yes": "dy",
  "decision-no": "dn",
} as const;

export type CallbackAction = keyof typeof CALLBACK_ACTIONS;

export interface Callback {
  readonly action: CallbackAction;
  readonly id: string;
}

const BY_CODE = new Map<string, CallbackAction>(
  (Object.entries(CALLBACK_ACTIONS) as [CallbackAction, string][]).map(([action, code]) => [
    code,
    action,
  ]),
);

export function encodeCallback(callback: Callback): string {
  if (!UUID.test(callback.id)) throw new RangeError("Данные кнопки: ожидается uuid.");
  return `${CALLBACK_ACTIONS[callback.action]}:${callback.id}`;
}

/** Разбор данных нажатой кнопки; не наша форма — undefined (нажатие молча игнорируется). */
export function decodeCallback(data: string): Callback | undefined {
  const [code, id, ...rest] = data.split(":");
  if (code === undefined || id === undefined || rest.length > 0 || !UUID.test(id)) return undefined;
  const action = BY_CODE.get(code);
  return action === undefined ? undefined : { action, id };
}
