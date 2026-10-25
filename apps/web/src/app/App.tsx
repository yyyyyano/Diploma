// Корень сайта (ARCHITECTURE §10.1): провайдеры i18n, Mantine с темой «Пуща и янтарь», TanStack Query и роутер.
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../lib/i18n.ts";
import type { SessionSource } from "../lib/session.ts";
import { cssVariablesResolver, theme } from "../ui/theme/theme.ts";
import { createAppRouter } from "./router.tsx";

export function App({ session }: { readonly session: SessionSource }) {
  const [i18n] = useState(createI18n);
  const [queryClient] = useState(() => new QueryClient());
  const [router] = useState(() => createAppRouter({ queryClient, session }));
  return (
    <I18nextProvider i18n={i18n}>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        forceColorScheme="light"
      >
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </MantineProvider>
    </I18nextProvider>
  );
}
