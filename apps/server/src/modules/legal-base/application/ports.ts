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

/** Что источник даёт сверх текста (Национальный реестр, LAW-30): карточка акта и лёгкая проверка размера страницы. */
export interface RegistrySource {
  /** Карточка акта (`guid=3961`): вступление в силу, утрата силы, изменяющие акты. */
  fetchActCard(pravoId: string): Promise<SourcePage>;
  /** HEAD страницы текста без сжатия: размер для сравнения с последним снимком; нет текста — `ActTextNotFound`. */
  headActText(pravoId: string): Promise<{ readonly contentLength: number | null }>;
}

/** Новые поступления и рубрики Национального реестра (LAW-12, LAW-14). */
export interface DiscoverySource {
  /** Страница «Новые поступления» за один день (`p0=p1=ДД.ММ.ГГГГ`). */
  fetchArrivals(day: LocalDate): Promise<SourcePage>;
  /** Страница рубрик ЕПК акта (`guid=11031`); нет страницы (акт не из тематических банков) — null. */
  fetchActRubrics(pravoId: string): Promise<SourcePage | null>;
}

/** Страницы ведомственных сайтов (LAW-15): та же вежливость, пауза и robots — отдельно на каждый хост. */
export interface AgencySource {
  fetchAgencyPage(url: string): Promise<SourcePage>;
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
   * Взять аренду очереди запросов (LAW-35: без параллельных запросов): под `pg_advisory_xact_lock` читает «следующий
   * запрос не раньше»; если этот момент наступил — ставит его в `now + leaseMs` (аренда на время запроса: таймаут +
   * пауза) и возвращает `null`, иначе возвращает момент, до которого очередь занята. HTTP внутри транзакции нет.
   */
  tryAcquire(now: Date, leaseMs: number): Promise<Date | null>;
  /**
   * Вернуть аренду, взятую в `acquiredAt`, после ответа или ошибки: следующий запрос не раньше `end + pauseMs` —
   * пауза отсчитывается от конца запроса. Чужую аренду (своя истекла и очередь уже занял другой) не трогает.
   */
  release(acquiredAt: Date, end: Date, pauseMs: number): Promise<void>;
  read(): Promise<LoaderState>;
  stop(day: LocalDate, reason: LoaderStopReason): Promise<void>;
  /** Снять остановку (наступил новый день). */
  resume(): Promise<void>;
  saveRobots(text: string, at: Date): Promise<void>;
  /** Записать запрос в журнал и счётчики цикла дня `day` (в новый день счётчики с нуля); вернуть счётчики. */
  record(entry: RequestRecord, day: LocalDate): Promise<{ requests: number; errors: number }>;
}
