// Сквозной сценарий на чистой базе стенда (AUTH-10, AUTH-08, STMT-01, NFR-24): первый заход на сайт → экран первого
// запуска → администратор создан → вход → «Наличные · 0,00 BYN» (их создаёт worker по событию, список обновляется сам).
// На каждом маршруте — axe 0 нарушений WCAG 2.2 AA и нет горизонтальной прокрутки при 1440 и 390 px. Сценарий один и
// последовательный: первый запуск у базы стенда — один раз.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const admin = { email: "admin@example.test", password: "пароль-администратора" };

/** axe и прокрутка при 1440 и 390: нарушения — с размером окна, чтобы было видно, где. */
async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
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

test("первый запуск → администратор → вход → «Наличные · 0,00 BYN»; axe 0 на 1440 и 390", async ({
  page,
}) => {
  const own = new URL(test.info().project.use.baseURL ?? "").origin;
  const foreign: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "data:" && url.origin !== own) foreign.push(request.url());
  });

  // AUTH-10: чистая система, локальный вход — стартовый маршрут ведёт на первый запуск.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Создайте администратора" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  await page.getByRole("textbox", { name: "Email администратора" }).fill(admin.email);
  await page.getByLabel("Пароль", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Создать администратора" }).click();

  // Администратор создан — вход с пометкой.
  await expect(page).toHaveURL(/\/login\?created=true$/);
  await expect(page.getByRole("status")).toContainText("Администратор создан");
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Экран первого запуска больше не доступен.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/login$/);

  // AUTH-08: вход.
  await page.getByRole("textbox", { name: "Email" }).fill(admin.email);
  await page.getByLabel("Пароль", { exact: true }).fill(admin.password);
  await page.getByRole("button", { name: "Войти" }).click();

  // STMT-01: «Наличные» с самого начала — их создаёт worker, список обновляется без перезагрузки.
  await expect(page).toHaveURL(/\/accounts$/);
  const cash = page.getByRole("article", { name: "Наличные" });
  await expect(cash).toBeVisible({ timeout: 15_000 });
  await expect(cash).toContainText(/0,00\s*BYN/);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Вошедшему первый запуск и вход не нужны: «/setup» ведёт в раздел.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/accounts$/);

  // Выход — снова вход.
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(foreign).toEqual([]);
});
