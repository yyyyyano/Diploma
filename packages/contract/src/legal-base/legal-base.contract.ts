// Правовая база (LAW-10, AUTH-10): прогресс стартового каталога для экрана первого запуска. Показывается до входа и только
// с этого компьютера (как прогресс моделей); у системной задачи нет домохозяйства — опрос раз в 2 с. Тексты актов и
// публичная «База законов» — T-038.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Причина остановки загрузчика законов (LAW-36, LAW-38): текст — из словаря i18n по коду. */
export const LoaderStopReason = z.enum([
  "LOADER_CONTACT_EMPTY",
  "LOADER_BLOCKED",
  "LOADER_TOO_MANY_ERRORS",
]);
export type LoaderStopReason = z.infer<typeof LoaderStopReason>;

/**
 * «Загружено 14 из 28 актов» (LAW-10). off — автозагрузка выключена (`legal-base.autoload`); waiting — первый запуск
 * ещё не пройден или каталог не заведён; loading — идёт; ready — все акты загружены; stopped — загрузчик остановлен.
 */
export const LawsStartupProgress = z.strictObject({
  state: z.enum(["off", "waiting", "loading", "ready", "stopped"]),
  done: z.int().min(0),
  total: z.int().min(0),
  /** Акты, которые не удалось загрузить сейчас (карантин, ошибка): загрузка повторится сама. */
  problems: z.int().min(0),
  stopReason: LoaderStopReason.nullable(),
});
export type LawsStartupProgress = z.infer<typeof LawsStartupProgress>;

/** Темы «Кошта» (LAW-01) и две группы витрины: «Персональные данные» (Закон № 99-З) и «Разъяснения Пленума» (LAW-04). */
export const LAW_GROUPS = [
  "taxes",
  "consumer",
  "housing",
  "banking",
  "work",
  "benefits",
  "contracts",
  "education-health",
  "family",
  "fines",
  "privacy",
  "plenum",
] as const;
export const LawGroup = z.enum(LAW_GROUPS);
export type LawGroup = z.infer<typeof LawGroup>;

/**
 * Состояние акта для читателя (LEGAL-05, LEGAL-06, LAW-32, LAW-34): действует, есть принятые изменения, ещё не вошедшие в
 * текст, только карточка (текста на pravo.by нет), утратил силу.
 */
export const LawStatus = z.enum(["active", "has-changes", "card-only", "repealed"]);
export type LawStatus = z.infer<typeof LawStatus>;

export const LawListItem = z.strictObject({
  pravoId: z.string().max(20),
  title: z.string().max(500),
  /** «law», «code», «decree», «resolution», «plenum». */
  kind: z.string().max(20),
  /** Краткое имя («НК (Особенная часть)»), если оно есть. */
  shortName: z.string().max(100).nullable(),
  status: LawStatus,
  /** Утратил силу с этого дня (ISO), если утратил. */
  repealedOn: z.iso.date().nullable(),
  /** День снимка действующей редакции; у акта без текста — null. */
  editionOn: z.iso.date().nullable(),
  group: LawGroup.nullable(),
  isNpa: z.boolean(),
  hasText: z.boolean(),
});
export type LawListItem = z.infer<typeof LawListItem>;

export const LawCatalog = z.strictObject({
  acts: z.array(LawListItem).max(5000),
  counts: z.strictObject({
    total: z.int().min(0),
    withText: z.int().min(0),
    cardOnly: z.int().min(0),
    withChanges: z.int().min(0),
  }),
  /** Самая свежая редакция в базе (ISO-день): «Редакция на 21.10.2026». */
  editionOn: z.iso.date().nullable(),
});
export type LawCatalog = z.infer<typeof LawCatalog>;

/** Пункт оглавления: статья (`key` — её номер, `216.1`) или страница акта без статей (`key` — `p:<номер>`). */
export const LawTocEntry = z.strictObject({
  key: z.string().max(30),
  kind: z.enum(["article", "page"]),
  /** Номер статьи или страницы. */
  number: z.string().max(20),
  heading: z.string().max(500).nullable(),
  /** Раздел, глава и т. п. над статьёй, от старшего к младшему. */
  group: z.array(z.string().max(300)).max(6),
});
export type LawTocEntry = z.infer<typeof LawTocEntry>;

export const LawPendingChange = z.strictObject({
  description: z.string().max(400),
  inForceOn: z.iso.date().nullable(),
  /** Статьи, которые меняет изменяющий акт (проверены по его тексту); пусто — предупреждение на уровне акта. */
  articles: z.array(z.string().max(20)).max(60),
});
export type LawPendingChange = z.infer<typeof LawPendingChange>;

export const LawActView = z.strictObject({
  act: LawListItem,
  /** Время получения текста с pravo.by. */
  fetchedAt: z.iso.datetime().nullable(),
  url: z.url(),
  cardUrl: z.url(),
  toc: z.array(LawTocEntry).max(5000),
  pending: z.array(LawPendingChange).max(50),
});
export type LawActView = z.infer<typeof LawActView>;

export const LawFragmentView = z.strictObject({
  /** Версия фрагмента: на неё ссылается цитата (CHAT-10). */
  versionId: z.uuid(),
  pathKey: z.string().max(80),
  heading: z.string().max(500).nullable(),
  text: z.string().max(60_000),
  excluded: z.boolean(),
});
export type LawFragmentView = z.infer<typeof LawFragmentView>;

export const legalBaseContract = {
  /** «База законов» открыта всем (LEGAL-11): каталог актов с состоянием и темой. */
  catalog: oc.route({ method: "GET", path: "/legal-base/catalog" }).output(LawCatalog),
  /** Акт: реквизиты, оглавление и принятые изменения; текст — отдельно по частям (`fragments`). */
  act: oc
    .route({ method: "GET", path: "/legal-base/act" })
    .input(z.strictObject({ pravoId: z.string().regex(/^[A-Za-z][A-Za-z0-9]{5,11}$/u) }))
    .output(LawActView)
    .errors(pickErrors("NOT_FOUND")),
  /** Часть текста акта: статья (`key` = номер) или страница акта без статей (`p:<номер>`); весь НК одним ответом не отдаётся. */
  fragments: oc
    .route({ method: "GET", path: "/legal-base/fragments" })
    .input(
      z.strictObject({
        pravoId: z.string().regex(/^[A-Za-z][A-Za-z0-9]{5,11}$/u),
        key: z.string().regex(/^(?:\d{1,4}(?:\.\d{1,3})?|p:\d{1,4})$/u),
      }),
    )
    .output(z.strictObject({ fragments: z.array(LawFragmentView).max(500) }))
    .errors(pickErrors("NOT_FOUND")),
  /** «ст. 210 НК» → акт и статья; не по форме или такой статьи нет — `null` (тогда ищем по названию). */
  resolve: oc
    .route({ method: "GET", path: "/legal-base/resolve" })
    .input(z.strictObject({ q: z.string().trim().min(1).max(200) }))
    .output(
      z.strictObject({
        target: z.strictObject({ pravoId: z.string(), key: z.string() }).nullable(),
      }),
    ),

  startupProgress: oc
    .route({ method: "GET", path: "/legal-base/startup-progress" })
    .output(LawsStartupProgress)
    .errors(pickErrors("NOT_FOUND")),
};
