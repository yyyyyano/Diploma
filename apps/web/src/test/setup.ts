// Настройка проекта Vitest web (ADR-0013): утверждения jest-dom, сеть — только MSW (неописанный запрос — ошибка,
// а не поход в сеть: NFR-11), и то, чего нет в jsdom, но ждёт Mantine (matchMedia, ResizeObserver).
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw.ts";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
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
}
