// Публичный API @kosht/contract — форма данных «на проводе» (паспорт — packages/contract/CLAUDE.md).
export {
  AccountId,
  AccountKind,
  AccountListItem,
  accountsContract,
} from "./accounts/accounts.contract.ts";
export {
  actionsContract,
  Decision,
  DecisionAnswer,
  DecisionId,
  DecisionStatus,
  DecisionSummary,
  UndoToken,
} from "./actions/actions.contract.ts";
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
export {
  Explanation,
  explainContract,
  TraceNodeSchema,
  TraceRef,
} from "./explain/explain.contract.ts";
export { ChangedEvent, ProgressEvent, SiteEvent } from "./events/events.contract.ts";
export { FileRef, filesContract } from "./files/files.contract.ts";
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
export {
  ConsentKind,
  ConsentRecord,
  ConsentVersion,
  PrivacyState,
  privacyContract,
  RegistrationConsents,
  SetCloudConsentInput,
} from "./privacy/privacy.contract.ts";
export {
  ADMIN_NOTIFICATION_KINDS,
  AdminNotification,
  AdminNotificationKind,
  FeedInput,
  NotificationChannel,
  NotificationParams,
  notificationsContract,
  ObjectRef,
  Preference,
  USER_NOTIFICATION_KINDS,
  UserNotification,
  UserNotificationKind,
} from "./notifications/notifications.contract.ts";
export { contract } from "./router.ts";
