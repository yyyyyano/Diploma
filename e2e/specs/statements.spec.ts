// «Импорт выписки» (STMT-03, STMT-04, STMT-07, STMT-11, NFR-21): свой пользователь → «Чеки и документы» → синтетический
// CSV из datasets/statements → разбор в worker → предпросмотр «Нашёл 30 операций по карте •• 4821» → «Импортировать 30»
// → «Отменить» не нужен: выписка в списке «Импортирована» → повторная загрузка того же файла — «30 из них уже были
// загружены» и импорт недоступен → откат с подтверждением. axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при
// 1440 и 390: пусто, предпросмотр, окно «Исправить колонки», окно отката.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const CSV = fileURLToPath(
  new URL("../../datasets/statements/lesbank-csv-september/statement.csv", import.meta.url),
);

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

test("«Чеки и документы»: выписка → предпросмотр → импорт → повторная загрузка (дубли) → откат; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `statements-${String(Date.now())}@example.test`;
  const password = "кошт2026выписка";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Пропустить анкету" }).click();
  await page.goto("/documents");

  // Пусто: что здесь будет.
  await expect(page.getByRole("heading", { name: "Выписок пока нет" })).toBeVisible({
    timeout: 15_000,
  });
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // STMT-03: загрузка файла; STMT-04: разбор в worker и предпросмотр с числами сервера.
  await page.locator('input[type="file"]').setInputFiles(CSV);
  const preview = page.getByRole("region", { name: "Предпросмотр импорта" });
  await expect(preview).toContainText("Нашёл 30 операций по карте •• 4821", { timeout: 60_000 });
  await expect(preview).toContainText("Остатки сходятся.");
  await expect(preview.getByRole("button", { name: "Импортировать 30" })).toBeEnabled();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // «Исправить колонки»: окно с ролями каждой колонки.
  await preview.getByRole("button", { name: "Исправить колонки" }).click();
  await expect(page.getByRole("dialog", { name: "Исправить колонки" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.keyboard.press("Escape");

  // Импорт одной транзакцией: выписка в списке «Импортирована».
  await preview.getByRole("button", { name: "Импортировать 30" }).click();
  await expect(page.getByText("Импортировано 30 операций.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Лесбанк •• 4821" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Импортирована" })).toBeVisible();

  // КП STMT: повторная загрузка той же выписки — всё уже было, импортировать нечего.
  await page.locator('input[type="file"]').setInputFiles(CSV);
  await expect(page.getByRole("region", { name: "Предпросмотр импорта" })).toContainText(
    "30 из них уже были загружены",
    { timeout: 60_000 },
  );
  await expect(page.getByRole("button", { name: "Импортировать 0" })).toBeDisabled();
  await page.getByRole("button", { name: "Отмена" }).click();

  // STMT-11: откат с подтверждением — окно называет число операций.
  await page
    .getByRole("listitem")
    .filter({ hasText: "Импортирована" })
    .getByRole("button", { name: "Открыть предпросмотр" })
    .click();
  await page.getByRole("button", { name: "Откатить импорт" }).click();
  const dialog = page.getByRole("dialog", { name: "Откатить импорт?" });
  await expect(dialog).toContainText("30 операций");
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await dialog.getByRole("button", { name: "Откатить" }).click();
  await expect(page.getByText("Импорт откатан.")).toBeVisible();
});
