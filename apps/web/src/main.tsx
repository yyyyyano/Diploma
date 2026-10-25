// Точка входа сайта: стили темы один раз, затем приложение с сессией из процедур identity.
import "./ui/theme/index.ts";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App.tsx";
import { client } from "./lib/api.ts";
import { createApiSession } from "./lib/session.ts";

const root = document.getElementById("root");
if (root === null) throw new Error("В index.html нет элемента #root.");

createRoot(root).render(
  <StrictMode>
    <App session={createApiSession(client)} />
  </StrictMode>,
);
