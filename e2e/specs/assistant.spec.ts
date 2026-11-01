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

test("«Ассистент»: панель с контекстом страницы, диалоги, плашка режима, микрофон; axe 0 при 1440 и 390", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const email = `assistant-${String(Date.now())}@example.test`;
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
