// «Операции» (TXN-01…05, P5, AGT-07, DES-16): свой пользователь → пусто → ввод операции (окно) → строка в таблице и
// «Записал…» → карточка (поля, история) → правка суммы → удаление после «Да» и «Отменить» после него → фильтр без
// результата. axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: загрузка, ошибка, пусто, окно
// ввода, список, карточка, подтверждение удаления, «Ничего не нашлось». Только BYN: курсы НБРБ e2e не запрашивает.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { holdUndoToast } from "./support/undo-toast.ts";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
/** Список операций (но не карточка и не «Откуда курс?»). */
const LIST_URL = /\/api\/transactions(\?|$)/;

async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
}

/** `settle: false` — скелетон загрузки мерцает бесконечно (shimmer): конец анимаций ждать нечего. */
async function accessibleAtBothWidths(page: Page, settle = true) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    if (settle) await animationsSettled(page);
    const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    for (const v of result.violations) {
      problems.push({
        width: size.width,
        id: v.id,
        targets: v.nodes.map((n) => n.target.join(" ")),
      });
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (overflow > 0) problems.push({ width: size.width, overflow });
  }
  await page.setViewportSize(VIEWPORTS[0]);
  return problems;
}

test("«Операции»: ввод, карточка, правка, удаление после «Да» и «Отменить»; axe 0 при 1440 и 390", async ({
  page,
}) => {
  // Много состояний и по два прохода axe; ошибка загрузки появляется после трёх повторов запроса (~7 с).
  test.setTimeout(120_000);
  const email = `operations-${String(Date.now())}@example.test`;
  const password = "кошт2026операции";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.getByRole("link", { name: "Счета", exact: true }).first().click();
  await expect(page.getByRole("article", { name: "Наличные" })).toBeVisible({ timeout: 15_000 });

  // DES-16, загрузка: ответ списка придержан — скелетон; затем отпущен.
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(LIST_URL, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/operations");
  await expect(page.getByText("Загрузка…").first()).toBeVisible();
  expect(await accessibleAtBothWidths(page, false)).toEqual([]);
  release();

  // DES-16, пусто: «Операций пока нет» (придержанный ответ дошёл — тогда снимаем перехват).
  await expect(page.getByRole("heading", { name: "Операций пока нет" })).toBeVisible();
  await page.unroute(LIST_URL);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // DES-16, ошибка: сервер молчит — «Операции не загрузились» и «Повторить».
  await page.route(LIST_URL, (route) => route.fulfill({ status: 503, body: "" }));
  await page.reload();
  // Запрос повторяется трижды с паузами (1, 2, 4 с) — ошибка видна позже обычного.
  await expect(page.getByRole("heading", { name: "Операции не загрузились" })).toBeVisible({
    timeout: 15_000,
  });
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  // «Повторить» проверяет компонентный тест; здесь — сервер ожил, страница открывается заново.
  await page.unroute(LIST_URL);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Операций пока нет" })).toBeVisible();

  // TXN-03: ввод операции — окно с формой (axe с открытой формой), категория из списка.
  await page.getByRole("button", { name: "Добавить операцию" }).first().click();
  const form = page.getByRole("dialog", { name: "Новая операция" });
  await expect(form).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await form.getByLabel("Сумма, BYN").fill("6,50");
  await form.getByLabel("Контрагент").fill("Кофейня «Зерно»");
  await form.getByPlaceholder("Выберите категорию").click();
  await page.getByRole("option", { name: "Кафе, рестораны и доставка" }).click();
  await form.getByRole("button", { name: "Сохранить" }).click();

  // TXN-01: строка в таблице, «Записал…» с «Отменить»; на телефоне — карточка списка.
  await holdUndoToast(page, /Записал: Кофейня «Зерно»/);
  const open = page.getByRole("button", { name: "Открыть операцию: Кофейня «Зерно»" });
  await expect(open).toBeVisible();
  await expect(page.getByText("Найдено: 1 операция")).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // TXN-05: карточка операции — поля, источник категории и история.
  await open.click();
  const panel = page.getByRole("dialog", { name: "Операция" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Категория — выбрана вами")).toBeVisible();
  await expect(panel.getByText(/Записана на сайте/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // TXN-03: правка суммы — сразу, с историей.
  await panel.getByRole("button", { name: "Изменить" }).click();
  const edit = page.getByRole("dialog", { name: "Изменить операцию" });
  await edit.getByLabel("Сумма, BYN").fill("8,00");
  await edit.getByRole("button", { name: "Сохранить" }).click();
  await holdUndoToast(page, "Изменил операцию: Кофейня «Зерно».");
  await expect(panel.getByText(/Изменено на сайте: сумма/)).toBeVisible();

  // AGT-07, TXN-03: удаление — только после «Да», затем «Отменить».
  await panel.getByRole("button", { name: "Удалить" }).click();
  await expect(page.getByText(/Удалить операцию «Кофейня «Зерно»/)).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Да, выполнить" }).click();
  const undoDelete = await holdUndoToast(page, "Операция удалена: Кофейня «Зерно».");
  await expect(page.getByRole("heading", { name: "Операций пока нет" })).toBeVisible();
  await undoDelete.click();
  await expect(open).toBeVisible();

  // TXN-04: вторая операция, выбор обеих, смена категории — окно выбора, вопрос с числом, «Да», «Отменить».
  await page.getByRole("button", { name: "Добавить операцию" }).first().click();
  const second = page.getByRole("dialog", { name: "Новая операция" });
  await second.getByLabel("Сумма, BYN").fill("9,80");
  await second.getByLabel("Контрагент").fill("Яндекс Go");
  await second.getByRole("button", { name: "Сохранить" }).click();
  await holdUndoToast(page, /Записал: Яндекс Go/);
  await page.getByRole("checkbox", { name: "Выбрать все показанные" }).check();
  await expect(page.getByText("Выбрано: 2")).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Сменить категорию" }).click();
  const pick = page.getByRole("dialog", { name: "Сменить категорию" });
  await pick.getByPlaceholder("Выберите категорию").click();
  await page.getByRole("option", { name: "Общественный транспорт" }).click();
  await pick.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByText(/в «Общественный транспорт»\?/)).toBeVisible();
  await page.mouse.move(0, 0);
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Да, перенести 2" }).click();
  const undoBulk = await holdUndoToast(page, "Перенёс операций: 2.");
  await undoBulk.click();
  await expect(page.getByText("Перенёс операций: 2.")).toHaveCount(0);

  // TXN-02: фильтр без результата — «Ничего не нашлось», «Сбросить фильтры» возвращает список.
  await page.goto("/operations?type=income");
  await expect(page.getByRole("heading", { name: "Ничего не нашлось" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Сбросить фильтры" }).first().click();
  await expect(open).toBeVisible();
});
