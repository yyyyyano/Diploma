// Публичный API @kosht/contract — форма данных «на проводе» (паспорт — packages/contract/CLAUDE.md).
export {
  AccountId,
  AccountKind,
  AccountListItem,
  accountsContract,
} from "./accounts/accounts.contract.ts";
export {
  ChatMessage,
  chatContract,
  ConversationId,
  MessageStatus,
  RunId,
  RunMetadata,
  SendInput,
  UiMessageChunk,
  UiMessagePart,
} from "./chat/chat.contract.ts";
export { CardPart, ChatMessagePart, StepPart, TextPart } from "./chat/message-parts.ts";
export { PageContext } from "./chat/page-context.ts";
export {
  EntityId,
  EntityKind,
  LocalDate,
  Money,
  PageNumber,
  PageSize,
  RowCount,
} from "./common.ts";
export {
  ERROR_CODES,
  ERRORS,
  ErrorData,
  ErrorParams,
  isRetryable,
  pickErrors,
  type ErrorCode,
} from "./errors.ts";
export { ChangedEvent, ProgressEvent, SiteEvent } from "./events/events.contract.ts";
export {
  Email,
  ChangePasswordInput,
  identityContract,
  IssuedRecoveryCode,
  LinkToken,
  NewPassword,
  Password,
  PasswordResetInput,
  PasswordResetRequestInput,
  RecoverWithCodeInput,
  RecoveryCode,
  RegisterInput,
  Role,
  SessionUser,
  SetupInput,
  SignInInput,
  VerifyEmailInput,
} from "./identity/identity.contract.ts";
export { MailboxMessage, mailContract, MailNoteKind } from "./mail/mail.contract.ts";
export { ConsentVersion, RegistrationConsents } from "./privacy/privacy.contract.ts";
export { contract } from "./router.ts";
