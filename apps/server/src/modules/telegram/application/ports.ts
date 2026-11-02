// Порты бота (ARCHITECTURE §4.4): сценарии не знают grammY — они получают нормализованное событие и пишут в чат через
// BotApi. Реализация поверх grammY — infrastructure/bot; в тестах сценариев — записывающая подмена.

/** Кнопка под сообщением: `data` — callback (≤ 64 байт, callback-data.ts), `url` — ссылка. */
export interface Button {
  readonly text: string;
  readonly data?: string;
  readonly url?: string;
}
export type Keyboard = readonly (readonly Button[])[];

/** Файл из Telegram больше предела — «загрузите на сайте». */
export class FileTooLargeError extends Error {
  override readonly name = "FileTooLargeError";
}

/** Отправка без опроса (любой процесс: воркер, api): только отправить и поправить сообщение. */
export type Sender = Pick<BotApi, "send" | "edit">;

export interface BotApi {
  /** Отправить сообщение (обычный текст, без разметки — SEC-05); id сообщения — чтобы потом поправить кнопки. */
  send(chatId: number, text: string, keyboard?: Keyboard): Promise<number>;
  edit(chatId: number, messageId: number, text: string, keyboard?: Keyboard): Promise<void>;
  /** Картинка с подписью (график, TG-08): подписи — текстом в `caption`, в самой картинке текста нет. */
  sendPhoto(chatId: number, png: Uint8Array, caption: string, keyboard?: Keyboard): Promise<void>;
  /** Ответ потоком: черновики, деление на сообщения по 4096 знаков; при ошибке черновика — одним сообщением. */
  stream(chatId: number, text: AsyncIterable<string>): Promise<void>;
  /** Скачать файл; больше `maxBytes` — `FileTooLargeError` (до скачивания, по размеру из Telegram, и по факту). */
  download(fileId: string, maxBytes: number, knownSize?: number): Promise<Uint8Array>;
  leave(chatId: number): Promise<void>;
  /** Убрать «часики» на нажатой кнопке. */
  answerCallback(callbackId: string): Promise<void>;
}

/** Откуда пришло сообщение: личный чат и время отправки (TG-10 — «сегодня» по нему, а не по обработке). */
export interface Origin {
  readonly chatId: number;
  readonly fromId: number;
  readonly chatType: string;
  readonly username: string | null;
  readonly sentAt: Date;
}

/** Команды меню бота (TG-07, TG-09). */
export const BOT_COMMANDS = [
  "balance",
  "week",
  "limits",
  "undo",
  "model",
  "new",
  "password",
  "unlink",
  "help",
] as const;
export type BotCommand = (typeof BOT_COMMANDS)[number];

export type BotEvent =
  | { readonly kind: "start"; readonly argument: string }
  | { readonly kind: "command"; readonly name: BotCommand }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "photo"; readonly fileId: string; readonly size: number | undefined }
  | {
      readonly kind: "document";
      readonly fileId: string;
      readonly name: string;
      readonly mime: string | undefined;
      readonly size: number | undefined;
    }
  | { readonly kind: "voice"; readonly fileId: string; readonly duration: number }
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "callback";
      readonly callbackId: string;
      readonly messageId: number;
      /** Текст сообщения с кнопками: после нажатия к нему дописывается итог, кнопки уходят. */
      readonly text: string;
      readonly data: string;
    };

export interface Incoming {
  readonly origin: Origin;
  readonly event: BotEvent;
}

/** Что опрос ждёт от обработчика обновлений: принять событие (ответ — когда работа выполнена, опросу ждать не нужно). */
export interface UpdateHandler {
  handle(incoming: Incoming, api: BotApi): Promise<void>;
}
