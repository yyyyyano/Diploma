// Публичный вход экрана laws (паспорт — CLAUDE.md рядом): страницы — отдельными чанками (`lazyPage`: бюджет первой загрузки),
// схемы адресов и рамка гостя — сразу.
import { lazyPage } from "../../lib/lazy-page.tsx";

export const LawsPage = lazyPage(() => import("./LawsPage.tsx"), "LawsPage");
export const LawReaderPage = lazyPage(() => import("./LawReaderPage.tsx"), "LawReaderPage");
export { GuestFrame } from "./GuestFrame.tsx";
export { LawsSearch, ReaderSearch } from "./model/search.ts";
