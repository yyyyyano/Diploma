// Настройка проекта Vitest web (ADR-0013): утверждения jest-dom, сеть — только MSW (неописанный запрос — ошибка,
// а не поход в сеть: NFR-11), и то, чего нет в jsdom, но ждёт Mantine (matchMedia, ResizeObserver). Сообщение jsdom
// «Not implemented: …» (переход по ссылке, которого тест не отменил, и т. п.) роняет тест, а не тонет в выводе.
import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw.ts";

// Ожидание `findBy*` и `waitFor`: страницы маршрутов — ленивые чанки (`lazyPage`), и при полном прогоне `make check` (десятки
// воркеров, холодный импорт сотен модулей) первая отрисовка экрана идёт дольше стандартной секунды (AUTH-07 «на Главную» падал
// только под нагрузкой). Срок — с запасом, как `testTimeout` проекта int (T-011): скорость здесь не проверяется, а утверждения те же.
configure({ asyncUtilTimeout: 5_000 });

/** Сообщения jsdom о том, чего он не умеет, за текущий тест. */
const jsdomGaps: string[] = [];

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  const gaps = jsdomGaps.splice(0);
  if (gaps.length > 0) {
    throw new Error(`jsdom не умеет то, что сделал тест: ${gaps.join("; ")}`);
  }
});
afterAll(() => server.close());

class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// Тесты с `@vitest-environment node` (конфиг сборки) DOM не получают — заглушки DOM им не нужны.
if (typeof window !== "undefined") installDomGaps();

function installDomGaps(): void {
  // «Not implemented: …» jsdom сообщает событием jsdomError своей виртуальной консоли (окружение Vitest кладёт JSDOM
  // в globalThis.jsdom); в консоль Node оно уходит мимо перехвата Vitest, поэтому слушаем само событие.
  const { jsdom } = globalThis as unknown as {
    jsdom: {
      virtualConsole: { on(event: "jsdomError", fn: (e: Error & { type?: string }) => void): void };
    };
  };
  jsdom.virtualConsole.on("jsdomError", (e) => {
    if (e.type === "not-implemented") jsdomGaps.push(e.message);
  });
  // Mantine читает медиазапросы (useMediaQuery, цветовая схема); в jsdom их нет — ни один запрос не совпадает.
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
  window.ResizeObserver = NoopResizeObserver;
  // Mantine прокручивает к активному элементу и ждёт scrollIntoView, которого в jsdom нет.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  // Textarea autosize Mantine пересчитывает высоту по загрузке шрифтов (document.fonts) — в jsdom их нет.
  if (!("fonts" in document)) {
    Object.defineProperty(document, "fonts", {
      value: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        ready: Promise.resolve(),
      },
    });
  }
  // Роутер восстанавливает прокрутку при переходах (scrollRestoration); jsdom её не умеет и пишет в консоль.
  window.scrollTo = () => {};
}
