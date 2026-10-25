// Точка входа сайта: стили темы один раз, затем приложение.
import "./ui/theme/index.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { guestSession } from "./lib/session.ts";

const root = document.getElementById("root");
if (root === null) throw new Error("В index.html нет элемента #root.");

createRoot(root).render(
  <StrictMode>
    {/* TODO(T-009): сессия из модуля identity (вход, выход, роль) вместо гостя. */}
    <App session={guestSession} />
  </StrictMode>,
);
