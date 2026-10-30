// Порты legal-base: внешний мир (pravo.by) и состояние вежливого загрузчика (ARCHITECTURE §4.2). Ошибки — классы
// без данных страницы и без контакта оператора: в лог и в уведомления идёт только код (OBS-04).
import type { LocalDate } from "@kosht/kernel";

/** Страница, полученная от источника: HTML целиком и момент получения. */
export interface SourcePage {
  readonly html: string;
  readonly fetchedAt: Date;
}

/** Источник текстов законов. Боевой — pravo.by (PoliteFetcher), в тестах и стенде e2e — сохранённые страницы. */
export interface LegalSource {
  /** Страница текста акта (`guid=3871`); у акта без текста — `ActTextNotFound`. */
  fetchActText(pravoId: string): Promise<SourcePage>;
}

/** Код остановки загрузчика: показывается администратору текстом из словаря i18n. */
export type LoaderStopReason = "LOADER_CONTACT_EMPTY" | "LOADER_BLOCKED" | "LOADER_TOO_MANY_ERRORS";

/** Загрузчик остановлен: пустой контакт (LAW-36), 403/429 или слишком много ошибок за цикл (LAW-38). */
export class LoaderStopped extends Error {
  readonly reason: LoaderStopReason;
  constructor(reason: LoaderStopReason) {
    super(`Загрузчик законов остановлен: ${reason}.`);
    this.name = "LoaderStopped";
    this.reason = reason;
  }
}

/** pravo.by не отвечает (5xx, таймаут) даже после лесенки повторов: акт откладывается до следующего цикла. */
export class SourceUnavailable extends Error {
  constructor() {
    super("pravo.by недоступен после повторов.");
    this.name = "SourceUnavailable";
  }
}

/** Страницы текста нет (404): у акта только карточка. */
export class ActTextNotFound extends Error {
  constructor() {
    super("Текста акта на pravo.by нет.");
    this.name = "ActTextNotFound";
  }
}

/** robots.txt запрещает адрес (LAW-37): запрос не отправлялся. */
export class RobotsDenied extends Error {
  constructor() {
    super("robots.txt запрещает адрес.");
    this.name = "RobotsDenied";
  }
}

/** Страница больше предела (настройка): не читается дальше. */
export class PageTooLarge extends Error {
  constructor() {
    super("Страница больше допустимого размера.");
    this.name = "PageTooLarge";
  }
}

export interface LoaderState {
  readonly stoppedOn: LocalDate | null;
  readonly stopReason: LoaderStopReason | null;
  readonly robotsTxt: string | null;
  readonly robotsFetchedAt: Date | null;
  readonly cycleDay: LocalDate | null;
  readonly cycleRequests: number;
  readonly cycleErrors: number;
}

export interface RequestRecord {
  readonly at: Date;
  /** Адрес без параметров поиска: путь и p0 — для журнала администратора (LAW-40). */
  readonly url: string;
  readonly httpStatus: number | null;
  readonly bytes: number | null;
  readonly ms: number;
  readonly outcome: string;
  readonly isError: boolean;
}

/** Состояние загрузчика в БД: общее для всех процессов, переживает перезапуск (LAW-35). */
export interface LoaderStore {
  /**
   * Занять место в очереди запросов: под `pg_advisory_xact_lock` читает «следующий запрос не раньше», ставит
   * `max(now, это) + pause` и возвращает момент, когда можно слать запрос. HTTP внутри транзакции нет.
   */
  reserveSlot(now: Date, pauseMs: number): Promise<Date>;
  read(): Promise<LoaderState>;
  stop(day: LocalDate, reason: LoaderStopReason): Promise<void>;
  /** Снять остановку (наступил новый день). */
  resume(): Promise<void>;
  saveRobots(text: string, at: Date): Promise<void>;
  /** Записать запрос в журнал и счётчики цикла дня `day` (в новый день счётчики с нуля); вернуть счётчики. */
  record(entry: RequestRecord, day: LocalDate): Promise<{ requests: number; errors: number }>;
}
