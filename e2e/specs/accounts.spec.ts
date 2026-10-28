// «Счета» (STMT-01, STMT-02, EXPL-01, P5, AGT-07): свой пользователь → анкета пропущена → «Наличные» и итог в BYN →
// ⓘ итога открывает сохранённый расчёт → новый вклад с начальным остатком → переименование и «Отменить» → удаление
// только после «Да». axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390: список, панель
// «Откуда эта цифра?», окно нового счёта, окно подтверждения. Только BYN: курсы НБРБ e2e не запрашивает (без сети).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/** Окна и списки Mantine появляются с переходом прозрачности: axe посреди перехода видит бледный текст. */
async function animationsSettled(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );
}

async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await animationsSettled(page);
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

test("«Счета»: итог с «Откуда эта цифра?», добавить, переименовать с «Отменить», удалить после «Да»; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `accounts-${String(Date.now())}@example.test`;
  const password = "кошт2026счета";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // STMT-01, STMT-02: «Наличные» с самого начала и день остатка; итог в BYN.
  const cash = page.getByRole("article", { name: "Наличные" });
  await expect(cash).toBeVisible({ timeout: 15_000 });
  await expect(cash).toContainText("Остаток на");
  await expect(page.getByText("Всего на счетах")).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // EXPL-01: ⓘ итога — сохранённый расчёт в панели «Откуда эта цифра?».
  await page.getByRole("button", { name: "Откуда эта цифра: всего на счетах" }).click();
  await expect(page.getByRole("dialog", { name: "Откуда эта цифра?" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.keyboard.press("Escape");

  // STMT-01: новый вклад с начальным остатком — окно формы, axe с открытой формой.
  await page.getByRole("button", { name: "Добавить счёт" }).first().click();
  const form = page.getByRole("dialog", { name: "Новый счёт" });
  await expect(form).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await form.getByText("Вклад", { exact: true }).click();
  await form.getByRole("textbox", { name: "Название" }).fill("Отпуск");
  await form.getByRole("textbox", { name: /Начальный остаток/ }).fill("150,00");
  await form.getByRole("button", { name: "Добавить счёт" }).click();
  await expect(page.getByText("Добавил счёт «Отпуск»")).toBeVisible();
  const deposit = page.getByRole("article", { name: "Отпуск" });
  await expect(deposit).toContainText(/150,00\sBYN/);

  // P5: переименовать сразу, «Отменить» возвращает прежнее название.
  await page.getByRole("button", { name: "Действия со счётом «Отпуск»" }).click();
  await page.getByRole("menuitem", { name: "Переименовать" }).click();
  await page.getByRole("textbox", { name: "Название счёта" }).fill("Отпуск летом");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByRole("article", { name: "Отпуск летом" })).toBeVisible();
  await page.getByRole("button", { name: "Отменить" }).click();
  await expect(page.getByRole("article", { name: "Отпуск" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // AGT-07: удаление — только после «Да».
  await page.getByRole("button", { name: "Действия со счётом «Отпуск»" }).click();
  await page.getByRole("menuitem", { name: "Удалить счёт" }).click();
  await expect(page.getByText(/Удалить счёт «Отпуск»\?/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await expect(deposit).toBeVisible();
  await page.getByRole("button", { name: "Да, выполнить" }).click();
  await expect(page.getByRole("article", { name: "Отпуск" })).toHaveCount(0);
});
