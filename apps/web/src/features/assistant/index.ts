// Публичный вход фичи assistant (паспорт — CLAUDE.md рядом): маршрут `/assistant` и каркас импортируют только этот файл
// (web-routes-thin). Страница и панель — ленивыми чанками: чат, Markdown и AI SDK не едут в первую загрузку сайта.
import { lazyPage } from "../../lib/lazy-page.tsx";

export const AssistantPage = lazyPage(() => import("./AssistantPage.tsx"), "AssistantPage");
export { AssistantSearch } from "./model/search.ts";
export { FloatingAssistant } from "./FloatingAssistant.tsx";
