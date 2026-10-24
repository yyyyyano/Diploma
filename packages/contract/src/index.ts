// Публичный API @kosht/contract — форма данных «на проводе» (паспорт — packages/contract/CLAUDE.md).
export { LocalDate, Money, PageNumber, PageSize, RowCount } from "./common.ts";
export {
  ERROR_CODES,
  ERRORS,
  ErrorData,
  ErrorParams,
  isRetryable,
  pickErrors,
  type ErrorCode,
} from "./errors.ts";
