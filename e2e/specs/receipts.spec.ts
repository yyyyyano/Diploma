// «Фото чека → карточка» (RCPT-01, RCPT-02, RCPT-07, RCPT-08, RCPT-10, RCPT-11, RCPT-12, RCPT-04, TXN-01): свой пользователь →
// «Чеки и документы» → синтетическое фото из datasets/receipts (с QR) → распознавание в worker (подготовка в потоке, QR,
// чтение тестовой моделью, валидатор) → карточка «Сумма сходится 100%» с «Ожидает выписки» → «Верно» → то же фото второй раз —
// «Этот чек уже загружен» → в «Операциях» признак «Ожидает выписки» → «Отменить» чек. axe 0 нарушений WCAG 2.2 AA и нет
// горизонтальной прокрутки при 1440 и 390 (на 390 — телефонное сканирование: та же карточка с полем «Камера / Галерея»).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const PHOTO = fileURLToPath(
  new URL("../../datasets/receipts/sosnovy-clean-card/receipt.jpg", import.meta.url),
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

test("фото чека → карточка «Сумма сходится 100%» → «Верно» → дубль → «Операции» → «Отменить»; axe 0 при 1440 и 390", async ({
  page,
}) => {
  const email = `receipts-${String(Date.now())}@example.test`;
  const password = "кошт2026чеки";
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

  // RCPT-01: поле — фото, несколько сразу, без capture (на телефоне браузер предложит «Камера / Галерея»).
  const field = page.getByLabel("Фото чека");
  await expect(field).toHaveAttribute("accept", "image/*,.heic");
  await expect(field).toHaveAttribute("multiple", "");
  await expect(field).not.toHaveAttribute("capture", /.*/);
  await expect(page.getByText("Чеков пока нет — сфотографируйте первый.")).toBeVisible({
    timeout: 15_000,
  });
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // RCPT-02…07: загрузка → worker → карточка с результатом проверки.
  await field.setInputFiles(PHOTO);
  const card = page.getByRole("region", { name: "ООО «Сосновый»" });
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.getByText("Сумма сходится 100%")).toBeVisible();
  await expect(card.getByText("Ожидает выписки", { exact: true })).toBeVisible();
  await expect(card.getByText("Молоко 3,2% 1л")).toBeVisible();
  await expect(card.getByRole("button", { name: "Верно" })).toBeEnabled();
  await expect(card.getByRole("button", { name: "Изменить" })).toBeVisible();
  // RCPT-11, RCPT-12: фото открывается, МНС — ссылка (запросов к сервису нет), УИ и день копируются.
  await expect(card.getByRole("link", { name: "Открыть фото" })).toHaveAttribute(
    "href",
    /\/api\/files\//,
  );
  await expect(card.getByRole("link", { name: "Проверить на сайте МНС" })).toHaveAttribute(
    "href",
    "https://ch.info-center.by/",
  );
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // RCPT-08: «Верно» — чек подтверждён.
  await card.getByRole("button", { name: "Верно" }).click();
  await expect(card.getByRole("button", { name: "Верно" })).toBeDisabled();

  // RCPT-04, КП RCPT: то же фото второй раз не создаёт чек — «Этот чек уже загружен dd.mm».
  await field.setInputFiles(PHOTO);
  await expect(page.getByText(/Этот чек уже загружен \d{2}\.\d{2}\./)).toBeVisible({
    timeout: 60_000,
  });
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // RCPT-10, TXN-01: в «Операциях» — предварительная операция «ожидает выписки» с чеком; фильтр «Чек».
  await page.goto("/operations?receipt=with");
  const row = page.getByRole("row", { name: /Сосновый/ });
  await expect(row.getByText("Ожидает выписки", { exact: true })).toBeVisible({ timeout: 15_000 });
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // RCPT-08: «Отменить» чек удаляет чек и его операцию.
  await page.goto("/documents");
  await page.getByRole("button", { name: /Сосновый/ }).click();
  await page.getByRole("button", { name: "Отменить" }).click();
  await page
    .getByRole("dialog", { name: "Отменить чек?" })
    .getByRole("button", { name: "Да, отменить" })
    .click();
  await page.goto("/operations?receipt=with");
  await expect(page.getByRole("row", { name: /Сосновый/ })).toHaveCount(0);
});
