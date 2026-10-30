// Карта модулей сервера — источник правды о модулях (ADR-0003, docs/ARCHITECTURE.md §5).
// Из неё генерируются правила границ (.dependency-cruiser.mjs через rules.ts), таблицы ярусов
// docs/CAPABILITIES.md (make capabilities) и области коммитов (commitlint.config.ts).
// Любая правка этого файла — отдельный пункт итога задачи с обоснованием; связь «вверх» — только через ADR
// (ARCHITECTURE §15). Столбцы «SPEC» и «Ответственность» хранятся дословно, чтобы генерация таблиц
// воспроизводила docs/CAPABILITIES.md без расхождений.

/** Ярус: 1 основа · 2 данные и знания · 3 расчёты и представления · 4 входы и оркестрация. */
export type Tier = 1 | 2 | 3 | 4;

/** Вид таблиц модуля (ARCHITECTURE §6.1): userOwnedTable, systemTable, publicTable. */
export type TableKind = "user" | "system" | "public";

export interface ModuleDef {
  /** Постоянное имя: папка apps/server/src/modules/<id>/, область коммита, префикс событий и задач. */
  readonly id: string;
  readonly tier: Tier;
  /** Требования SPEC — дословно столбец «SPEC». */
  readonly spec: string;
  /** Ответственность — дословно столбец «Ответственность». */
  readonly responsibility: string;
  /** Чьи фасады модуль может вызывать и на чьи события подписываться; остальное запрещает make deps-check. */
  readonly dependsOn: readonly string[];
  /** Виды таблиц модуля в порядке столбца «Таблицы». */
  readonly tables: readonly TableKind[];
  /** Ключевые события модуля (столбец «Публикует»). */
  readonly publishes: readonly string[];
}

export const MODULES: readonly ModuleDef[] = [
  // ── Ярус 1 ──
  {
    id: "files",
    tier: 1,
    spec: "SEC-03, RCPT-11, STMT-10, PRIV-05/06",
    responsibility:
      "приём файлов (тип по содержимому, лимиты), хранение `data/files/<householdId>/`, выдача владельцу, удаление",
    dependsOn: [],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "explain",
    tier: 1,
    spec: "EXPL-01/02, P2",
    responsibility:
      "хранит трассы `{value, trace}` рядом с результатом, отдаёт объяснение по `traceId`",
    dependsOn: [],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "actions",
    tier: 1,
    spec: "P5, AGT-05/07, TXN-03/04, TXN-10 (вопрос «одна покупка?»), TG-07 `/undo`, NOTIF-05",
    responsibility:
      "журнал отменяемых действий; ожидающие решения «Да/Нет» — подтверждения удаления и массовых действий, вопрос «чек и платёж по карте — одна покупка?» (одинаково на сайте, в боте и в чате, ARCHITECTURE §5); реестры обработчиков отмены и ответов",
    dependsOn: [],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "privacy",
    tier: 1,
    spec: "PRIV-01/02/05/06/08, AUTH-02",
    responsibility:
      "согласия с версией текста; экспорт и удаление аккаунта через реестр владельцев данных; политика ПД",
    // PRIV-05: архив «Мои данные» сохраняется файлом домохозяйства (files.save) и выдаётся files.download.
    dependsOn: ["files"],
    tables: ["user", "system"],
    publishes: ["privacy.consent-changed", "privacy.export-ready"],
  },
  {
    id: "mail",
    tier: 1,
    spec: "AUTH-03/04/06, ADM-60",
    responsibility: "SMTP, локальный почтовый ящик (только localhost), тестовое письмо",
    dependsOn: [],
    tables: ["system"],
    publishes: [],
  },
  {
    id: "identity",
    tier: 1,
    spec: "AUTH-01…12, ROLE-01/02, SEC-01/02, ADM-01, ADM-30, DEMO-04 (вход)",
    responsibility:
      "Better Auth (ядро) + первый запуск, код восстановления, роли, блокировка, последний админ, демо-вход, домохозяйство",
    dependsOn: ["mail", "privacy"],
    tables: ["system"],
    publishes: ["identity.system-initialized", "identity.user-registered", "identity.user-deleted"],
  },
  {
    id: "notifications",
    tier: 1,
    spec: "NOTIF-01…05, BUD-03, CAL-07 (доставка)",
    responsibility:
      "уведомления, центр, настройки по видам и каналам, реестр каналов доставки (web, telegram)",
    // privacy — событие privacy.export-ready и проверка готовности архива (уведомление «архив готов», PRIV-05).
    dependsOn: ["identity", "privacy"],
    // NOTIF-03: уведомления администраторов — без домохозяйства (systemTable), «прочитано» — у каждого админа своё.
    tables: ["user", "system"],
    publishes: [],
  },
  {
    id: "llm",
    tier: 1,
    spec: "LLM-01…10, NFR-04/05/25, PRIV-02/03/04/09, OBS-03, ADM-20/21/22/50",
    responsibility:
      "реестр моделей, адаптеры, цепочки по задачам, лимитёр, маскирование, журнал расхода, Langfuse, эмбеддинги, речь, локальные модели",
    dependsOn: ["privacy", "identity", "notifications"],
    tables: ["system", "user"],
    publishes: ["llm.local-models-ready"],
  },
  {
    id: "system",
    tier: 1,
    spec: "ADM-60, NFR-22/24, OBS-05/07",
    responsibility:
      "обзор фоновых задач, доступ из сети, резервная копия, часовой пояс, статус Langfuse",
    dependsOn: [],
    tables: ["system"],
    publishes: [],
  },

  // ── Ярус 2 ──
  {
    id: "profile",
    tier: 2,
    spec: "PROF-01…07, AGT-06 (факты), AUTH-07",
    responsibility:
      "факты (анкета, чат, выводы системы), статусы «подтверждён/предположение», «Что ассистент знает обо мне»",
    dependsOn: ["identity", "actions"],
    tables: ["user"],
    publishes: ["profile.facts-changed"],
  },
  {
    id: "fx-rates",
    tier: 2,
    spec: "STMT-09",
    responsibility: "курсы НБРБ по ISO-коду, кэш, эквивалент в BYN с трассой",
    dependsOn: ["explain"],
    tables: ["public"],
    publishes: [],
  },
  {
    id: "merchants",
    tier: 2,
    spec: "STMT-06, CAT-03 (справочник), RCPT-15, TXN-10 (похожесть)",
    responsibility:
      "очистка названий, справочник контрагентов РБ, алиасы, нечёткое сравнение, нормализация товаров",
    dependsOn: ["llm"],
    tables: ["public"],
    publishes: [],
  },
  {
    id: "categories",
    tier: 2,
    spec: "CAT-01…07, RCPT-09, CAT-04",
    responsibility:
      "встроенные категории (общие) и свои (домохозяйства), правила, гибридная категоризация пакетами",
    dependsOn: ["merchants", "llm"],
    tables: ["public", "user"],
    publishes: [],
  },
  {
    id: "accounts",
    tier: 2,
    spec: "STMT-01/02",
    responsibility:
      "счета, «Наличные», «Карта, не указана», остатки и дата остатка; пересчёт остатка по операциям (STMT-02) выполняет по вызову `transactions` — сам от `transactions` не зависит",
    dependsOn: ["identity", "fx-rates", "explain", "actions"],
    tables: ["user"],
    publishes: ["accounts.balances-changed"],
  },
  {
    id: "transactions",
    tier: 2,
    spec: "TXN-01…11, FIN-01, STMT-07/08 (запись), CAT-05 (применить к прошлым)",
    responsibility:
      "операции, разбивка по категориям, переводы и возвраты, предварительные, сопоставление чек ↔ выписка, массовые действия, агрегации пачками; вызывает фасад `accounts` для пересчёта остатка (STMT-02)",
    dependsOn: [
      "accounts",
      "categories",
      "merchants",
      "fx-rates",
      "actions",
      "explain",
      "notifications",
    ],
    tables: ["user"],
    publishes: ["transactions.changed", "transactions.merged"],
  },
  {
    id: "statements",
    tier: 2,
    spec: "STMT-03…12, SEC-10/11 (документы)",
    responsibility:
      "импорт: чтение PDF/XLSX/XLS/CSV/сканов, определение колонок, запоминание формата, дубли, типы, предпросмотр, откат",
    dependsOn: [
      "files",
      "accounts",
      "transactions",
      "categories",
      "merchants",
      "fx-rates",
      "llm",
      "actions",
      "notifications",
    ],
    tables: ["user"],
    publishes: ["statements.imported", "statements.rolled-back"],
  },
  {
    id: "receipts",
    tier: 2,
    spec: "RCPT-01…15, PRIV-04, SEC-11",
    responsibility:
      "чеки: QR, распознавание, валидатор, перепроверка, дубли, правка, гарантийные позиции",
    dependsOn: [
      "files",
      "transactions",
      "categories",
      "merchants",
      "llm",
      "actions",
      "notifications",
      "explain",
    ],
    tables: ["user"],
    publishes: ["receipts.recognized", "receipts.needs-review", "receipts.warranty-items-found"],
  },
  {
    id: "recurring",
    tier: 2,
    spec: "REC-01…05",
    responsibility: "поиск регулярных, ожидаемые даты, «возможно прекращён», подписки",
    dependsOn: ["transactions", "categories", "profile", "notifications", "actions", "explain"],
    tables: ["user"],
    publishes: ["recurring.changed"],
  },
  {
    id: "legal-base",
    tier: 2,
    spec: "LAW-01…40, LEGAL-11, ADM-10",
    responsibility:
      "каталог актов, загрузчик pravo.by, редакции и версии фрагментов, гибридный поиск, журнал спроса, публичная «База законов»",
    dependsOn: ["llm", "notifications", "identity"],
    tables: ["public", "system"],
    publishes: ["legal-base.act-updated", "legal-base.act-repealed"],
  },
  {
    id: "norm-tables",
    tier: 2,
    spec: "TAX-03, CAL-02 (сроки), AFF-05 (пределы ПДН), LAW-33, LEGAL-08, ADM-11",
    responsibility: "таблицы «параметр → период → значение → источник» с подтверждением человеком",
    dependsOn: ["legal-base", "notifications"],
    tables: ["public", "system"],
    publishes: ["norm-tables.values-confirmed"],
  },
  {
    id: "legal-consult",
    tier: 2,
    spec: "LEGAL-01…12, CHAT-05/06, P3",
    responsibility:
      "метки цитат `[[F…]]`, проверка дословности, «в моей базе нет», чек-листы документов и их состояние",
    dependsOn: ["legal-base"],
    tables: ["user"],
    publishes: [],
  },

  // ── Ярус 3 ──
  {
    id: "fin",
    tier: 3,
    spec: "FIN-01/20/21/22",
    responsibility: "свободный остаток, средний регулярный доход, прогноз остатка по дням",
    dependsOn: ["accounts", "transactions", "recurring", "profile", "explain"],
    tables: [],
    publishes: [],
  },
  {
    id: "budgets",
    tier: 3,
    spec: "BUD-01…07",
    responsibility: "лимиты, цели, копилка, рекомендуемый взнос, пороги уведомлений",
    dependsOn: [
      "accounts",
      "transactions",
      "categories",
      "fin",
      "notifications",
      "actions",
      "explain",
    ],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "calendar",
    tier: 3,
    spec: "CAL-01…08, PROF-07 (вопрос об имуществе)",
    responsibility:
      "события, напоминания (таблица `reminders` + тик), сроки налогов, гарантии, страховки",
    dependsOn: [
      "profile",
      "transactions",
      "recurring",
      "receipts",
      "norm-tables",
      "notifications",
      "actions",
    ],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "tax",
    tier: 3,
    spec: "TAX-01…07, TAX-20",
    responsibility: "калькулятор вычетов (через `calc`), найденные вычеты по операциям",
    dependsOn: [
      "profile",
      "transactions",
      "categories",
      "norm-tables",
      "legal-base",
      "legal-consult",
      "notifications",
      "explain",
    ],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "afford",
    tier: 3,
    spec: "AFF-01…08",
    responsibility: "три сценария покупки, просадки, безопасный платёж по ПДН",
    dependsOn: [
      "accounts",
      "transactions",
      "recurring",
      "fin",
      "budgets",
      "calendar",
      "norm-tables",
      "profile",
      "explain",
    ],
    tables: [],
    publishes: [],
  },
  {
    id: "weekly",
    tier: 3,
    spec: "WEEK-01…03",
    responsibility: "итоги недели: числа — `calc`, текст — модель",
    dependsOn: [
      "transactions",
      "budgets",
      "calendar",
      "recurring",
      "tax",
      "llm",
      "notifications",
      "explain",
    ],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "dashboard",
    tier: 3,
    spec: "DASH-01…04",
    responsibility: "сборка главного экрана (только чтение, пачками)",
    dependsOn: [
      "accounts",
      "transactions",
      "fin",
      "budgets",
      "recurring",
      "calendar",
      "tax",
      "weekly",
      "explain",
    ],
    tables: [],
    publishes: [],
  },
  {
    id: "xls-export",
    tier: 3,
    spec: "XLS-01…04",
    responsibility: "Excel с живыми формулами (без диаграмм, R43)",
    dependsOn: ["transactions", "categories", "budgets", "files"],
    tables: [],
    publishes: [],
  },

  // ── Ярус 4 ──
  {
    id: "voice",
    tier: 4,
    spec: "VOICE-01…03",
    responsibility: "речь → текст (облако по согласию, иначе whisper.cpp)",
    dependsOn: ["llm"],
    tables: [],
    publishes: [],
  },
  {
    id: "agent",
    tier: 4,
    spec: "AGT-01…14, SEC-10, LLM-10 (выбор в запуске)",
    responsibility:
      "цикл агента, реестр инструментов и наборов, подсказки, «вне темы», проверка чисел ответа, постобработка цитат",
    dependsOn: ["llm", "actions", "profile", "legal-consult"],
    tables: [],
    publishes: [],
  },
  {
    id: "chat",
    tier: 4,
    spec: "CHAT-01…10",
    responsibility:
      "диалоги, сообщения (`UIMessage.parts`), поток ответа, вложения, контекст страницы, «статья изменилась»",
    dependsOn: ["agent", "files", "receipts", "statements", "voice", "legal-base", "legal-consult"],
    tables: ["user"],
    publishes: [],
  },
  {
    id: "telegram",
    tier: 4,
    spec: "TG-01…11, PRIV-08 (подключение), AUTH-05 (сброс через бот)",
    responsibility: "бот: привязка, команды, фото/файлы/голос, канал доставки уведомлений",
    dependsOn: [
      "chat",
      "agent",
      "identity",
      "privacy",
      "notifications",
      "actions",
      "receipts",
      "statements",
      "voice",
      "dashboard",
      "budgets",
      "weekly",
    ],
    tables: ["system"],
    publishes: [],
  },
  {
    id: "demo",
    tier: 4,
    spec: "DEMO-01…04",
    responsibility: "демо-пользователь и связный набор данных от текущей даты (воспроизводимо)",
    dependsOn: [
      "identity",
      "privacy",
      "profile",
      "files",
      "accounts",
      "transactions",
      "receipts",
      "categories",
      "recurring",
      "budgets",
      "calendar",
      "weekly",
    ],
    tables: [],
    publishes: [],
  },
  {
    id: "quality",
    tier: 4,
    spec: "QA-10…16, ADM-40",
    responsibility: "eval-прогоны с бюджетом токенов, результаты, сравнение с прошлыми",
    dependsOn: [
      "llm",
      "receipts",
      "statements",
      "categories",
      "legal-base",
      "legal-consult",
      "agent",
    ],
    tables: ["system"],
    publishes: [],
  },
  {
    id: "admin",
    tier: 4,
    spec: "ADM-01…60 (экраны)",
    responsibility: "раздел «Администрирование»: собирает admin-фасады модулей; своих данных нет",
    dependsOn: [
      "identity",
      "privacy",
      "notifications",
      "mail",
      "llm",
      "legal-base",
      "norm-tables",
      "system",
      "quality",
      "demo",
    ],
    tables: [],
    publishes: [],
  },
];

/** Модуль хранит данные домохозяйства (userOwnedTable, ScopedDb, defineUserData). */
export function userData(m: ModuleDef): boolean {
  return m.tables.includes("user");
}

/** Модуль получает SystemDb: системные таблицы или запись в публичные (ARCHITECTURE §6.5). */
export function systemTables(m: ModuleDef): boolean {
  return m.tables.includes("system") || m.tables.includes("public");
}
