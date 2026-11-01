// «Вопрос в чате» (CHAT-01, CHAT-02, CHAT-08, CHAT-09, VOICE-02, PRIV-02, DES-10/11, NFR-21): свой пользователь → плавающая
// кнопка на главной открывает панель «Вижу: Главная · <месяц>» → вопрос уходит с контекстом страницы, шаг и карточка
// «Наличные» → «Открыть чат» → диалог в списке, новый диалог, переименование, удаление после подтверждения; плашка
// «Локальный режим» без облачного согласия; микрофон на localhost. axe 0 при 1440 и 390 (панель, страница, шторка
// диалогов на телефоне — после конца переходов) и нет горизонтальной прокрутки.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { shownSettled } from "./support/settled.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const DESKTOP = { width: 1440, height: 900 } as const;
const PHONE = { width: 390, height: 844 } as const;

/** Конец конечных переходов: панель и окна въезжают, и посреди перехода axe видит бледный текст (находка T-020). */
async function transitionsSettled(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.effect?.getComputedTiming().iterations === Infinity,
      ),
  );
}

async function problems(page: Page, label: string) {
  await transitionsSettled(page);
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const found: unknown[] = result.violations.map((v) => ({
    label,
    id: v.id,
    targets: v.nodes.map((node) => node.target.join(" ")),
  }));
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  if (overflow > 0) found.push({ label, overflow });
  return found;
}

/** Новый пользователь: регистрация, анкета пропущена, вход на главную (DESKTOP). */
async function signUp(page: Page, prefix: string) {
  const email = `${prefix}-${String(Date.now())}@example.test`;
  const password = "кошт2026ассистент";
  await page.setViewportSize(DESKTOP);
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test("«Ассистент»: панель с контекстом страницы, диалоги, плашка режима, микрофон; axe 0 при 1440 и 390", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page, "assistant");
  // «Наличные» новому пользователю создаёт worker (STMT-01): ждём счёт, иначе вопрос про счета уйдёт раньше него.
  await page.goto("/accounts");
  await expect(page.getByRole("article", { name: "Наличные" })).toBeVisible({ timeout: 15_000 });
  await page.goto("/home");

  // CHAT-08: плавающая кнопка на любой странице — панель справа, «Вижу: Главная · месяц год».
  await page.getByRole("button", { name: "Спросить ассистента" }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^Вижу: Главная · \S+ \d{4}$/)).toBeVisible();
  // CHAT-09: быстрые вопросы панели; VOICE-02: на localhost есть микрофон.
  await expect(panel.getByRole("button", { name: "Почему так много на такси?" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Надиктовать вопрос" })).toBeVisible();
  await shownSettled(panel);
  expect(await problems(page, "панель, 1440")).toEqual([]);

  // NFR-21: вопрос из панели — шаг подписью из словаря, затем карточка «Наличные» и текст.
  await panel.getByRole("textbox", { name: "Вопрос ассистенту" }).fill("Какие у меня счета?");
  await panel.getByRole("button", { name: "Отправить" }).click();
  await expect(panel.getByText("Смотрю ваши счета…")).toBeVisible();
  await expect(panel.getByText("Вот ваши счета: остаток каждого — на карточке ниже.")).toBeVisible({
    timeout: 10_000,
  });
  await expect(panel.getByRole("article", { name: "Наличные" })).toBeVisible();
  await expect(panel.getByRole("list", { name: "Что спросить дальше" })).toBeVisible();
  await shownSettled(panel);
  expect(await problems(page, "панель с ответом, 1440")).toEqual([]);

  // «Открыть чат»: страница с этим же диалогом; название — первое сообщение (без модели).
  await panel.getByRole("button", { name: "Открыть чат" }).click();
  await expect(page).toHaveURL(/\/assistant\?c=/);
  await expect(page.getByRole("heading", { level: 1, name: "Какие у меня счета?" })).toBeVisible();
  const list = page.getByRole("navigation", { name: "Диалоги" });
  await expect(list.getByRole("button", { name: "Диалог «Какие у меня счета?»" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  const feed = page.getByRole("log", { name: "Переписка с ассистентом" });
  await expect(feed.getByRole("article", { name: "Наличные" })).toBeVisible();
  // На самой странице чата плавающей кнопки нет.
  await expect(page.getByRole("button", { name: "Спросить ассистента" })).toHaveCount(0);

  // PRIV-02: без облачного согласия — плашка «Локальный режим» со ссылкой на настройку.
  const banner = page.getByRole("note").filter({ hasText: "Локальный режим" });
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("link", { name: "Настроить" })).toHaveAttribute(
    "href",
    "/settings?tab=privacy",
  );
  expect(await problems(page, "страница, 1440")).toEqual([]);

  // CHAT-01: новый диалог → вопрос → второй диалог в списке; название — вопрос.
  await page.getByRole("button", { name: "Новый диалог" }).first().click();
  await expect(page.getByRole("heading", { name: "Здравствуйте! Чем помочь?" })).toBeVisible();
  expect(await problems(page, "пустой диалог, 1440")).toEqual([]);
  await page.getByRole("button", { name: "Какие вычеты мне положены?" }).click();
  await expect(feed.getByText("Смотрю ваши счета…")).toBeVisible();
  await expect(
    list.getByRole("button", { name: "Диалог «Какие вычеты мне положены?»" }),
  ).toBeVisible();

  // Переименование и удаление после подтверждения.
  await list
    .getByRole("button", { name: "Действия с диалогом «Какие вычеты мне положены?»" })
    .click();
  await page.getByRole("menuitem", { name: "Переименовать" }).click();
  const field = page.getByRole("textbox", { name: "Название диалога" });
  await field.fill("Вычеты");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(list.getByRole("button", { name: "Диалог «Вычеты»" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Вычеты" })).toBeVisible();
  await list.getByRole("button", { name: "Действия с диалогом «Вычеты»" }).click();
  await page.getByRole("menuitem", { name: "Удалить" }).click();
  const confirm = page.getByRole("dialog", { name: "Удалить диалог?" });
  await shownSettled(confirm);
  expect(await problems(page, "удаление диалога, 1440")).toEqual([]);
  await confirm.getByRole("button", { name: "Да, удалить" }).click();
  await expect(list.getByRole("button", { name: "Диалог «Вычеты»" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Здравствуйте! Чем помочь?" })).toBeVisible();

  // Телефон: страница чата без горизонтальной прокрутки, список диалогов — шторкой; axe после конца перехода.
  await page.setViewportSize(PHONE);
  expect(await problems(page, "страница, 390")).toEqual([]);
  await page.getByRole("button", { name: "Список диалогов" }).click();
  const sheet = page.getByRole("dialog", { name: "Диалоги" });
  await expect(sheet).toBeVisible();
  await shownSettled(sheet);
  expect(await problems(page, "шторка диалогов, 390")).toEqual([]);
  await page.keyboard.press("Escape");

  // На телефоне плавающая кнопка открывает страницу чата, а не панель.
  await page.goto("/home");
  await page.getByRole("button", { name: "Спросить ассистента" }).click();
  await expect(page).toHaveURL(/\/assistant/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await problems(page, "страница после кнопки, 390")).toEqual([]);
});

// Карточки ответа (CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-10, DES-12): история диалога отдаётся заготовкой — модель в стенде
// одна кассета, а карточек нужны все виды: операция, подтверждение, итог «Да», чек-лист (настоящий шаблон сервера), правовой
// ответ с чипом и цитатой, мини-график, чек и выписка. axe 0 при 1440 и 390, включая раскрытую цитату (Popover / шторка).
const ids = {
  dialog: "0190f0a0-0000-7000-8000-00000000d001",
  tx: "0190f0a0-0000-7000-8000-00000000a001",
  account: "0190f0a0-0000-7000-8000-00000000a002",
  token: "0190f0a0-0000-7000-8000-00000000a003",
  decision: "0190f0a0-0000-7000-8000-00000000a004",
  receipt: "0190f0a0-0000-7000-8000-00000000a005",
  statement: "0190f0a0-0000-7000-8000-00000000a006",
  file: "0190f0a0-0000-7000-8000-00000000a007",
};
const mid = (n: number) => `0190f0a0-0000-7000-8000-00000000b0${String(n).padStart(2, "0")}`;
const money = (minor: number) => ({ minor, currency: "BYN" });
const text = (part: string) => ({ type: "text", text: part });
const user = (n: number, question: string) => ({
  id: mid(n),
  role: "user",
  status: "complete",
  parts: [text(question)],
});
const bot = (n: number, parts: unknown[], extra: object = {}) => ({
  id: mid(n),
  role: "assistant",
  status: "complete",
  parts,
  ...extra,
});
const tool = (name: string, output: unknown) => ({
  type: `tool-${name}`,
  toolCallId: `call-${name}`,
  state: "output-available",
  input: {},
  output,
});

const QUOTE =
  "Потребитель вправе в течение четырнадцати дней обменять непродовольственный товар надлежащего качества.";

const history = {
  conversationId: ids.dialog,
  title: "Карточки",
  messages: [
    user(1, "Потратил 15 рублей на кофе"),
    bot(2, [
      tool("add_transaction", {
        transaction: {
          id: ids.tx,
          accountId: ids.account,
          type: "expense",
          direction: "out",
          occurredOn: "2026-10-31",
          occurredTime: null,
          amount: money(1500),
          amountInByn: money(1500),
          description: "кофе",
          merchantName: "кофе",
          note: null,
          category: { type: "system", code: "cafes" },
          categorySource: "keyword",
          source: "assistant",
          visibility: "personal",
          transferPairId: null,
          refundOfId: null,
          importId: null,
          receiptId: null,
          pending: false,
          needsReview: false,
          version: 1,
        },
        undoToken: ids.token,
        categoryName: "Кафе, рестораны и доставка",
      }),
      text("Записал."),
    ]),
    user(3, "Удали все траты за вчера"),
    bot(4, [
      tool("delete_transaction", { ok: true, pending: { decisionId: ids.decision, count: 2 } }),
    ]),
    bot(5, [
      {
        type: "data-action-result",
        data: { decisionId: ids.decision, status: "yes", undoToken: ids.token },
      },
    ]),
    user(6, "Купил пылесос 10 дней назад, хочу вернуть"),
    bot(
      7,
      [
        tool("get_checklist", { id: "return-good-quality" }),
        {
          type: "data-law-answer",
          data: {
            outcome: "cited",
            parts: [
              { type: "text", text: "Обменять товар можно в течение четырнадцати дней " },
              { type: "cite", n: 1 },
              { type: "text", text: "." },
            ],
            citations: [
              {
                n: 1,
                kind: "quote",
                versionId: "v1",
                pravoId: "H10200090",
                actTitle: "Закон № 90-З «О защите прав потребителей»",
                label: "ст. 28, п. 1",
                path: "Закон › Статья 28",
                text: QUOTE,
                edition: "в редакции на 21.10.2026",
                editionOn: "2026-10-21",
                url: "https://pravo.by/document/?guid=3871&p0=H10200090",
                changedSince: false,
                notes: [],
              },
            ],
            notices: [{ kind: "disclaimer", text: "Не является юридической консультацией." }],
            versionIds: ["v1"],
          },
        },
      ],
      { changedVersionIds: ["v1"] },
    ),
    user(8, "Сколько на кафе за лето? Покажи график."),
    bot(9, [
      {
        type: "data-chart",
        data: {
          kind: "bar",
          title: "Кафе по месяцам",
          unit: "money",
          currency: "BYN",
          labels: ["июн", "июл", "авг"],
          series: [{ name: "Кафе", values: [4000, 6000, 5000] }],
        },
      },
    ]),
    { id: mid(10), role: "user", status: "complete", parts: [] },
    bot(11, [
      { type: "data-attachment", data: { kind: "receipt", id: ids.receipt } },
      { type: "data-attachment", data: { kind: "statement", id: ids.statement } },
    ]),
  ],
};

const receiptCard = {
  receipt: {
    id: ids.receipt,
    status: "ok",
    stage: null,
    disputedLines: [],
    errorCode: null,
    duplicateOf: null,
    storeName: "Евроопт",
    purchaseDate: "2026-10-20",
    purchaseTime: null,
    total: money(847),
    confirmed: false,
    rechecks: 0,
    createdAt: "2026-10-31T09:00:00.000Z",
  },
  unp: null,
  address: null,
  payment: null,
  receiptDiscount: money(0),
  remainder: money(0),
  mismatches: [],
  items: [
    {
      position: 1,
      name: "Молоко",
      normalizedName: "молоко",
      unit: null,
      quantityMilli: 1000,
      unitPrice: money(249),
      discount: money(0),
      lineTotal: money(249),
      disputed: false,
      category: null,
      warranty: false,
    },
  ],
  attempts: [],
  fileId: ids.file,
  operation: null,
  mns: null,
  traceId: null,
};

const statementDetail = {
  summary: {
    id: ids.statement,
    fileId: ids.file,
    status: "ready",
    bank: "Приорбанк",
    mask: null,
    currency: "BYN",
    period: null,
    found: 17,
    newCount: 15,
    duplicates: 2,
    doubtful: 0,
    skipped: 0,
    method: "detected",
    formatChanged: false,
    balance: null,
    warnings: [],
    errorCode: null,
    accountId: null,
    createdAt: "2026-10-31T09:00:00.000Z",
    importedAt: null,
  },
  rows: [],
  columns: null,
};

test("«Ассистент»: все виды карточек ответа, цитата по клику; axe 0 при 1440 и 390", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page, "cards");
  const json = (body: unknown) => (route: import("@playwright/test").Route) =>
    route.fulfill({ json: body });
  await page.route("**/api/chat/history**", json(history));
  await page.route("**/api/chat/conversations**", async (route) =>
    route.fulfill({
      json: {
        items: [
          { id: ids.dialog, title: "Карточки", updatedAt: new Date().toISOString(), preview: "" },
        ],
      },
    }),
  );
  await page.route(
    "**/api/actions/decision**",
    json({
      id: ids.decision,
      status: "yes",
      summary: { key: "decisions.fallback", params: {} },
      createdAt: "2026-10-31T09:00:00.000Z",
    }),
  );
  await page.route(`**/api/receipts/${ids.receipt}`, json(receiptCard));
  await page.route(`**/api/statements/imports/${ids.statement}`, json(statementDetail));

  await page.goto(`/assistant?c=${ids.dialog}`);
  const feed = page.getByRole("log", { name: "Переписка с ассистентом" });
  // Операция с «Отменить / Изменить».
  const operation = feed.getByRole("article", { name: "Кафе, рестораны и доставка" });
  await expect(operation).toBeVisible();
  await expect(operation.getByRole("button", { name: /Отменить запись/ })).toBeVisible();
  await expect(operation.getByRole("link", { name: "Изменить" })).toBeVisible();
  // Решение, на которое уже ответили, — итог без кнопок; итог «Да» с «Отменить».
  await expect(feed.getByText("Готово: действие выполнено.").first()).toBeVisible();
  // Чек-лист — настоящий шаблон сервера, галочки.
  await expect(feed.getByRole("heading", { name: /Возврат или обмен товара/ })).toBeVisible();
  const box = feed.getByRole("checkbox").first();
  await box.click();
  await expect(box).toBeChecked();
  // Правовой ответ: пометка об изменении статьи, чип, «Не является юридической консультацией».
  await expect(feed.getByText("Статья изменилась после ответа")).toBeVisible();
  await expect(feed.getByText("Не является юридической консультацией.")).toBeVisible();
  // График, чек, выписка.
  await expect(feed.getByRole("figure", { name: "График «Кафе по месяцам»" })).toBeVisible();
  await expect(feed.getByRole("article", { name: "Евроопт" })).toBeVisible();
  await expect(feed.getByRole("article", { name: "Выписка" })).toBeVisible();
  expect(await problems(page, "карточки, 1440")).toEqual([]);

  // Чип статьи раскрывает дословную цитату с датой редакции и ссылкой на pravo.by.
  await feed.getByRole("button", { name: "Показать цитату: ст. 28, п. 1" }).click();
  const quote = page.getByRole("dialog", { name: /ст\. 28/ });
  await expect(quote.getByText(QUOTE)).toBeVisible();
  await expect(quote.getByText("в редакции на 21.10.2026")).toBeVisible();
  await expect(quote.getByRole("link", { name: /ст\. 28/ })).toHaveAttribute(
    "href",
    "https://pravo.by/document/?guid=3871&p0=H10200090",
  );
  await shownSettled(quote);
  expect(await problems(page, "цитата, 1440")).toEqual([]);
  await page.keyboard.press("Escape");

  // Телефон: те же карточки без горизонтальной прокрутки; цитата — нижней шторкой.
  await page.setViewportSize(PHONE);
  await expect(feed.getByRole("figure", { name: "График «Кафе по месяцам»" })).toBeVisible();
  expect(await problems(page, "карточки, 390")).toEqual([]);
  await feed.getByRole("button", { name: "Показать цитату: ст. 28, п. 1" }).click();
  const sheet = page.getByRole("dialog", { name: "Цитата из закона" });
  await expect(sheet.getByText(QUOTE)).toBeVisible();
  await shownSettled(sheet);
  expect(await problems(page, "цитата шторкой, 390")).toEqual([]);
});
