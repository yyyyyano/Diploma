// Сервер MSW для тестов сайта: обработчики — в каждом тесте (server.use), общих по умолчанию нет.
import { setupServer } from "msw/node";

export const server = setupServer();
