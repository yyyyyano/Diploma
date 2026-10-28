// «Конфиденциальность» и «Мои данные» (PRIV-02, PRIV-05, PRIV-06): свой пользователь → облачное согласие дать (окно с
// текстом и отметкой) и отозвать → архив готовится задачей worker и скачивается, приходит уведомление «архив готов»
// → удаление аккаунта с паролем → вход с тем же паролем больше не работает. axe 0 нарушений WCAG 2.2 AA и нет
// горизонтальной прокрутки при 1440 и 390 на обеих вкладках, с окном согласия и окном удаления.
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

test("согласие, архив и удаление аккаунта; axe 0 на вкладках настроек при 1440 и 390", async ({
  page,
}) => {
  const email = `my-data-${String(Date.now())}@example.test`;
  const password = "кошт2026моиданные";
  await page.goto("/register");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page.getByRole("checkbox", { name: /согласен/ }).check();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page).toHaveURL(/\/accounts$/);

  // PRIV-02: облачное согласие — окно с текстом, «Дать согласие» после отметки; отзыв — сразу.
  await page.goto("/settings?tab=privacy");
  await expect(page.getByRole("heading", { level: 2, name: "Локальный режим" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "История согласий" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  const cloud = page.getByRole("switch", { name: "Разрешить облачные ИИ-модели" });
  await cloud.click({ force: true });
  const consent = page.getByRole("dialog", { name: "Согласие на облачную обработку" });
  await expect(consent).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await consent.getByRole("checkbox").check();
  await consent.getByRole("button", { name: "Дать согласие" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: /Облачные ИИ-модели: разрешены с/ }),
  ).toBeVisible();
  await expect(consent).toBeHidden();
  await cloud.click({ force: true });
  await expect(page.getByText("Согласие отозвано — локальный режим включён сразу.")).toBeVisible();

  // PRIV-05: архив собирает worker; вкладка узнаёт о готовности сама, приходит уведомление.
  await page.goto("/settings?tab=my-data");
  await expect(page.getByRole("button", { name: "Подготовить архив" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Подготовить архив" }).click();
  const download = page.getByRole("link", { name: "Скачать" });
  await expect(download).toBeVisible({ timeout: 30_000 });
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  const href = await download.getAttribute("href");
  const archive = await page.request.get(href ?? "");
  expect(archive.status()).toBe(200);
  expect(archive.headers()["content-type"]).toBe("application/zip");
  // Архив ZIP начинается с сигнатуры «PK».
  expect((await archive.body()).subarray(0, 2).toString("latin1")).toBe("PK");
  await page.getByRole("button", { name: /^Уведомления/ }).click();
  await expect(page.getByText(/Архив со всеми вашими данными готов/)).toBeVisible();
  await page.getByRole("button", { name: /^Уведомления/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Уведомления" })).toBeHidden();

  // PRIV-06: удаление с паролем — окно с перечнем; после — вход, тот же пароль больше не пускает.
  await page.getByRole("button", { name: "Удалить аккаунт…" }).click();
  const dialog = page.getByRole("dialog", { name: "Удалить аккаунт безвозвратно" });
  await expect(dialog).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await dialog.getByLabel("Пароль", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Удалить навсегда" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Пароль", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByRole("alert")).toContainText("Неверный email или пароль");
});
