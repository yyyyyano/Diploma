// RCPT-04: УИ чека из содержимого QR-кода. Формат полезной нагрузки настоящих чеков не проверялся (реального образца
// нет, research/architecture/06 §4.1): QR может нести сам УИ или ссылку, содержащую его. Ищем единственную группу из
// 24 букв и цифр; нет такой или их несколько разных — УИ неизвестен, и дубль определяется по магазину, дню, времени
// и итогу. Лучше пропустить УИ, чем принять чужую часть ссылки за идентификатор чека.
const UID = /(?<![0-9A-Za-z])[0-9A-Za-z]{24}(?![0-9A-Za-z])/g;

/** УИ в верхнем регистре или undefined. */
export function uidFromQr(payload: string): string | undefined {
  const found = new Set((payload.match(UID) ?? []).map((value) => value.toUpperCase()));
  const [only, ...others] = found;
  return only !== undefined && others.length === 0 ? only : undefined;
}
