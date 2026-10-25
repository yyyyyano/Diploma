// Отрисовка с провайдерами сайта (Mantine с темой, i18n) — для компонентных тестов ui/ и app/. env="test":
// Mantine без анимаций и порталов — панели и окна рисуются на месте, тест не ждёт переходов.
import { MantineProvider } from "@mantine/core";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../lib/i18n.ts";
import { cssVariablesResolver, theme } from "../ui/theme/theme.ts";

export function TestProviders({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        forceColorScheme="light"
        env="test"
      >
        {children}
      </MantineProvider>
    </I18nextProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions): RenderResult {
  return render(ui, { wrapper: TestProviders, ...options });
}
