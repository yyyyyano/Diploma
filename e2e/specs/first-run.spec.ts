// Сквозной сценарий на чистой базе стенда (AUTH-10, AUTH-05, AUTH-08, STMT-01, NFR-24): первый заход на сайт → экран
// первого запуска → администратор создан → код восстановления → вход → «Наличные · 0,00 BYN» (их создаёт worker по
// событию, список обновляется сам).
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

/** axe и прокрутка при 1440 и 390: нарушения — с размером окна, чтобы было видно, где. Перед axe — конец переходов. */
async function accessibleAtBothWidths(page: Page) {
  const problems: unknown[] = [];
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size);
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
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

test("первый запуск → администратор → вход → «Наличные · 0,00 BYN» → ассистент; axe 0 на 1440 и 390", async ({
  page: firstPage,
}) => {
  // Один длинный сценарий (первый запуск проходит один раз): axe на двух ширинах у десятка маршрутов не укладывается в 30 с.
  test.setTimeout(90_000);
  let page = firstPage;
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

  // AUTH-05: код восстановления администратора — один раз; «Продолжить» — после «сохранил».
  await expect(
    page.getByRole("heading", { level: 1, name: "Сохраните код восстановления" }),
  ).toBeVisible();
  await expect(page.getByText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("checkbox", { name: "Я сохранил(а) код в надёжном месте" }).check();
  await page.getByRole("button", { name: "Продолжить" }).click();

  // NFR-25 (T-024): «Готовим систему» — прогресс локальных моделей; в стенде скачивание выключено (интернета нет),
  // экран говорит, где его запустить; войти можно сразу.
  await expect(page.getByRole("heading", { level: 1, name: "Готовим систему" })).toBeVisible();
  await expect(page.getByText(/Скачивание ещё не начато/)).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("button", { name: "Войти" }).click();

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

  // AUTH-07, PROF-02: после первого входа — анкета на 1 минуту: ответ на первый вопрос, остальные пропущены, итог
  // «Вот что я запомнил»; axe на вопросе и на итоге.
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Как вы зарабатываете?" }),
  ).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByText("Наёмный работник", { exact: true }).click();
  await page.getByRole("button", { name: "Далее" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Сколько у вас детей?" })).toBeVisible();
  await page.getByRole("button", { name: "Больше детей" }).click();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  for (let question = 2; question <= 6; question += 1) {
    await page.getByRole("button", { name: "Пропустить вопрос" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Вот что я запомнил" })).toBeVisible();
  await expect(page.getByText("Наёмный работник")).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("link", { name: "Перейти на главную" }).click();

  // DASH-04: вошедшего встречает главная, у нового пользователя — «первые шаги».
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("heading", { name: "Добро пожаловать в Кошт" })).toBeVisible();
  // STMT-01: «Наличные» с самого начала — их создаёт worker, список обновляется без перезагрузки.
  await page.getByRole("link", { name: "Счета", exact: true }).first().click();
  await expect(page).toHaveURL(/\/accounts$/);
  const cash = page.getByRole("article", { name: "Наличные" });
  await expect(cash).toBeVisible({ timeout: 15_000 });
  await expect(cash).toContainText(/0,00\s*BYN/);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // CHAT-02, NFR-21: «Ассистент» на кассете — первое событие потока (подпись шага) не дольше 1 с после отправки,
  // ответ приходит по кускам (кассета с паузами ≥ 1,5 с), результат шага — карточка «Наличные».
  await page.goto("/assistant");
  await expect(page.getByRole("heading", { level: 1, name: "Ассистент" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  const feed = page.getByRole("log", { name: "Переписка с ассистентом" });
  await page.getByRole("textbox", { name: "Вопрос ассистенту" }).fill("Какие у меня счета?");
  const sent = Date.now();
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(feed.getByText("Смотрю ваши счета…")).toBeVisible();
  expect(Date.now() - sent).toBeLessThanOrEqual(1_000);
  const answer = feed.getByText("Вот ваши счета: остаток каждого — на карточке ниже.");
  await expect(answer).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - sent).toBeGreaterThanOrEqual(1_500);
  await expect(feed.getByRole("article", { name: "Наличные" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Запуск не привязан к вкладке: вопрос отправлен, вкладку закрыли — ответ дописан и виден при новом открытии.
  await page.getByRole("textbox", { name: "Вопрос ассистенту" }).fill("Какие у меня счета?");
  await page.getByRole("button", { name: "Отправить" }).click();
  await expect(feed.getByText("Смотрю ваши счета…")).toBeVisible();
  const context = page.context();
  await page.close();
  page = await context.newPage();
  // Ответ дописывается без вкладки: новая вкладка перезагружает историю, пока в ней не окажутся оба ответа.
  await expect
    .poll(
      async () => {
        await page.goto("/assistant");
        await page.getByRole("log", { name: "Переписка с ассистентом" }).waitFor();
        return page
          .getByRole("log", { name: "Переписка с ассистентом" })
          .getByText("Вот ваши счета: остаток каждого — на карточке ниже.")
          .count();
      },
      { timeout: 15_000, intervals: [500] },
    )
    .toBe(2);

  // Вошедшему первый запуск и вход не нужны: «/setup» ведёт в раздел.
  await page.goto("/setup");
  await expect(page).toHaveURL(/\/home$/);

  // ADM-30, ADM-60: администрирование — пункт меню только администратору; «/admin» открывает «Пользователи».
  await page.getByRole("link", { name: "Администрирование" }).first().click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  // Сценарии идут параллельно и заводят своих пользователей — их число заранее неизвестно.
  await expect(page.getByRole("heading", { level: 2, name: /^Пользователи · \d+$/ })).toBeVisible();
  await expect(page.getByText("вы", { exact: true })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("link", { name: "Система" }).click();
  await expect(page).toHaveURL(/\/admin\/system$/);
  await expect(page.getByRole("heading", { level: 2, name: "Фоновые задачи" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  // ADM-50, ADM-20 (T-023): «Провайдеры ИИ» — цепочки по задачам и ключи только для записи; «Запросы к ИИ» — цифры
  // журнала и период в адресе. Тестовая модель в боевой миграции выключена, а стенд отвечает кассетой.
  await page.getByRole("link", { name: "Провайдеры ИИ" }).click();
  await expect(page).toHaveURL(/\/admin\/ai-providers$/);
  await expect(page.getByRole("region", { name: "Чат и агент" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Ключи API" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Локальные модели" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("link", { name: "Запросы к ИИ" }).click();
  await expect(page).toHaveURL(/\/admin\/ai-requests\?period=day$/);
  await expect(page.getByRole("region", { name: "По задачам" })).toBeVisible();
  expect(await accessibleAtBothWidths(page)).toEqual([]);
  await page.getByRole("link", { name: "7 дней" }).click();
  await expect(page).toHaveURL(/period=week$/);
  expect(await accessibleAtBothWidths(page)).toEqual([]);

  // Выход — снова вход.
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(foreign).toEqual([]);
});
