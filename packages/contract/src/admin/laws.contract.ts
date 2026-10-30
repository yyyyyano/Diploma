// Вкладка «Законы» администрирования (LAW-40, ADM-10): состояние базы, расписание, список актов, журналы, очередь кандидатов,
// справочники. Ответы — метаданные общей правовой базы (актов, кодов, чисел): данных пользователей и текстов страниц нет
// (PRIV-07). Время — день и «ЧЧ:ММ» по поясу системы, уже готовые: сайт ничего не пересчитывает.
import { z } from "zod";
import { LawsStartupProgress } from "../legal-base/legal-base.contract.ts";

const Count = z.int().min(0);
const Hhmm = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export const LawPravoId = z.string().regex(/^[A-Za-z][A-Za-z0-9]{5,11}$/u);

/** Момент по поясу системы: день и «ЧЧ:ММ» (DES-17). */
export const LawMoment = z.strictObject({ day: z.iso.date(), time: Hhmm });
export type LawMoment = z.infer<typeof LawMoment>;

/**
 * Состояние акта для администратора: шесть статусов LAW-40 и «ждёт загрузки» (акт заведён, текст ещё не загружен — стартовый
 * каталог или недавно добавленный).
 */
export const LawAdminStatus = z.enum([
  "active",
  "has-changes",
  "card-only",
  "repealed",
  "quarantined",
  "failed",
  "pending",
]);
export type LawAdminStatus = z.infer<typeof LawAdminStatus>;

export const LawAdminAct = z.strictObject({
  pravoId: z.string().max(20),
  title: z.string().max(500),
  /** Тема LAW-01 или `privacy`; пусто — не определена. */
  topic: z.string().max(40).nullable(),
  status: LawAdminStatus,
  /** Код причины карантина или ошибки (`source-unavailable`, `load-failed`…); текст — из словаря сайта. */
  problem: z.string().max(60).nullable(),
  pendingChanges: Count,
  repealedOn: z.iso.date().nullable(),
  /** День действующей редакции; у акта без текста — null. */
  editionOn: z.iso.date().nullable(),
  /** Когда карточку акта читали в последний раз. */
  checkedOn: z.iso.date().nullable(),
});
export type LawAdminAct = z.infer<typeof LawAdminAct>;

export const LAW_ACT_PAGE_SIZE = 50;

export const LawAdminActs = z.strictObject({
  items: z.array(LawAdminAct).max(100),
  /** Сколько актов подходит под фильтр; `counts` — по каждому статусу без фильтра («Все 433», «Актуален 171»…). */
  total: Count,
  counts: z.strictObject({
    all: Count,
    active: Count,
    "has-changes": Count,
    "card-only": Count,
    repealed: Count,
    quarantined: Count,
    failed: Count,
    pending: Count,
  }),
  page: z.int().min(1),
  pageSize: z.int().min(1).max(100),
});
export type LawAdminActs = z.infer<typeof LawAdminActs>;

export const LawsOverview = z.strictObject({
  summary: z.strictObject({
    /** С полным текстом, ищутся по статьям и цитируются. */
    inIndex: Count,
    /** Только карточка: текста на pravo.by нет. */
    cardOnly: Count,
    repealed: Count,
    /** Кандидаты в очереди администратора. */
    candidates: Count,
    withChanges: Count,
    quarantined: Count,
    failed: Count,
  }),
  /** Стартовый каталог: «Загружено N из M». */
  startup: LawsStartupProgress,
  vectors: z.strictObject({
    state: z.enum(["idle", "working", "waiting-model"]),
    total: Count,
    embedded: Count,
    model: z.string().max(100).nullable(),
  }),
  schedule: z.strictObject({
    autoUpdate: z.boolean(),
    checkTime: Hhmm,
    windowFrom: Hhmm,
    windowTo: Hhmm,
    /** Итог последней проверки (из журнала): прошла или остановилась, числа — без текстов. */
    lastCheck: z
      .strictObject({
        at: LawMoment,
        ok: z.boolean(),
        updated: Count,
        problems: Count,
        /** Причина остановки (`LOADER_BLOCKED`…), если не прошла. */
        stopReason: z.string().max(40).nullable(),
      })
      .nullable(),
    /** Следующая проверка по расписанию; автообновление выключено — null. */
    nextCheck: LawMoment.nullable(),
  }),
  newActsMode: z.enum(["auto", "suggest"]),
  loaderContact: z.string().max(254),
  /** Заголовок User-Agent загрузчика: контакт виден администратору, в логи не пишется. */
  userAgent: z.string().max(400),
});
export type LawsOverview = z.infer<typeof LawsOverview>;

export const LawUpdateEntry = z.strictObject({
  at: LawMoment,
  /** Код события: `loaded`, `edition-applied`, `quarantined`, `repealed`, `candidate-dropped`, `daily-check`… */
  event: z.string().max(60),
  pravoId: z.string().max(20).nullable(),
  title: z.string().max(500).nullable(),
  /** Числа и коды без текстов страниц. */
  details: z.record(z.string().max(40), z.union([z.string().max(200), z.number()])),
});
export type LawUpdateEntry = z.infer<typeof LawUpdateEntry>;

export const LawFetchEntry = z.strictObject({
  at: LawMoment,
  url: z.string().max(500),
  httpStatus: z.int().nullable(),
  bytes: Count.nullable(),
  ms: Count.nullable(),
  outcome: z.string().max(40),
});
export type LawFetchEntry = z.infer<typeof LawFetchEntry>;

export const LawCandidate = z.strictObject({
  id: z.uuid(),
  pravoId: z.string().max(20),
  title: z.string().max(500).nullable(),
  kindLine: z.string().max(500).nullable(),
  /** Откуда найден: граф ссылок, ведомственная страница, журнал спроса, новые поступления. */
  source: z.enum(["start-catalog", "link-graph", "new-arrivals", "agency", "demand", "admin"]),
  /** Почему в очереди: `no-topic`, `suggest-only`, `manual-decision`, `text-appeared`. */
  reason: z.string().max(40).nullable(),
  hasText: z.boolean().nullable(),
  topic: z.string().max(40).nullable(),
  foundOn: z.iso.date().nullable(),
});
export type LawCandidate = z.infer<typeof LawCandidate>;

export const LawCandidates = z.strictObject({ items: z.array(LawCandidate).max(500) });

/** Что меняет администратор в настройках «Законов»; не переданное — не меняется. */
export const SetLawsSettingsInput = z.strictObject({
  autoUpdate: z.boolean().optional(),
  newActsMode: z.enum(["auto", "suggest"]).optional(),
  /** Контакт оператора для User-Agent (LAW-36): email или адрес сайта; пустой останавливает загрузчик. */
  loaderContact: z.string().trim().max(254).optional(),
  checkTime: Hhmm.optional(),
  windowFrom: Hhmm.optional(),
  windowTo: Hhmm.optional(),
});

/** «Добавить по ссылке / списком»: ссылки pravo.by или ID актов, до 200 строк; что не распознано — в ответе. */
export const AddLawActsInput = z.strictObject({
  links: z.array(z.string().max(500)).min(1).max(200),
});
export const AddLawActsResult = z.strictObject({
  accepted: Count,
  /** Строки, из которых не удалось получить ID акта. */
  rejected: z.array(z.string().max(500)).max(200),
});

export const LAW_DICTIONARY_KINDS = [
  "start-catalog",
  "epk-topics",
  "title-patterns",
  "organs",
  "aliases",
  "colloquial",
  "agency-pages",
] as const;
export const LawDictionaryKind = z.enum(LAW_DICTIONARY_KINDS);
export type LawDictionaryKind = z.infer<typeof LawDictionaryKind>;

/** Справочник целиком: поля строки (имя, вид ввода, варианты) и строки. Один вид ответа на семь редакторов. */
export const LawDictionary = z.strictObject({
  kind: LawDictionaryKind,
  fields: z
    .array(
      z.strictObject({
        name: z.string().max(40),
        type: z.enum(["text", "area", "select"]),
        options: z.array(z.string().max(40)).max(40).optional(),
        required: z.boolean(),
      }),
    )
    .max(10),
  rows: z
    .array(
      z.strictObject({
        /** Ключ строки: правка и удаление — по нему. */
        id: z.string().max(1100),
        values: z.record(z.string().max(40), z.string().max(1000)),
      }),
    )
    .max(2000),
});
export type LawDictionary = z.infer<typeof LawDictionary>;

export const LawDictionaryUpsertInput = z.strictObject({
  kind: LawDictionaryKind,
  /** Ключ правимой строки; `null` — новая. */
  id: z.string().max(1100).nullable(),
  values: z.record(z.string().max(40), z.string().max(1000)),
});
