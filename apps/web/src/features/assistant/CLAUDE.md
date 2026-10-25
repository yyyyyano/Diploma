# Экран `assistant` — Ассистент

Маршрут: `/assistant` (`routes/_app/assistant.tsx`) · доступ: пользователь (без сессии — `/login`). Пункт меню —
«Ассистент» (главная группа; на телефоне — третий). Панель чата в каркасе и маршрут диалога — T-043.

## Макет
- Исходник: `design/screens/Assistant.dc.html`; описание — `design/SCREENS.md` § «Ассистент» (и MobileChat).
- Скриншоты: `design/screenshots/desktop/Assistant.png`, `design/screenshots/mobile-width/Assistant.png`.

## Требования SPEC
CHAT-02 (поток, подписи шагов), NFR-21, AGT-01; состояния — DES-16; доступность — NFR-20.

## Данные (контракт)
- Чтение: `orpc.chat.history` — последний диалог и сообщения (`loader` — `prefetchQuery`).
- Поток: `useChat` (AI SDK 7) с транспортом `model/transport.ts` — `client.chat.send` → итератор событий oRPC →
  `eventIteratorToUnproxiedDataStream` → куски UI-сообщения; диалог транспорт запоминает из истории или куска
  `start` (`RunMetadata`). Переподключения к идущему ответу нет (`reconnectToStream` → null) — T-043.
- Изменение: `orpc.chat.stop({ runId })` — «Остановить ответ» (запуск на сервере освобождает модель); отмена запроса
  `useChat.stop` только отписывает вкладку. После ответа — перезапрос `chat.history`.
- Контекст ассистента: `staticData.page = "assistant"`.

## Компоненты
Свои: `AssistantPage` (лента `role="log"` с `aria-live="off"` + скрытая живая область вех, поле вопроса). Из
`entities`: `account` (`AccountCard` — карточка результата `list_accounts`). Из `ui`: `PageHeader`, `EmptyState`,
`SkeletonText`. Mantine: `Textarea` (autosize), `ActionIcon`.

## Части ответа
`text` — абзац (простой текст; Markdown — T-043); `tool-<имя>` — пока выполняется, подпись шага из словаря `tools`
по имени (`tools:fallback` для неизвестного), `output-available` с `items` — карточки счетов, `{ ok: false }` или
`output-error` — «Шаг не удался»; ответ со `status: interrupted` — «Ответ прерван».

## Отличия от макета (с причиной)
- Только лента: список диалогов, поиск, подсказки-вопросы, вложения, микрофон, выбор модели, карточки чека и
  графика — T-043; кусок без модуля скрыт (ARCHITECTURE §10.5).
- Шапка — `PageHeader` «Ассистент» вместо названия диалога: названия диалогов — T-043.

## Готово, когда
Тесты (`AssistantPage.test.tsx`: поток, шаг, «Остановить», история, ошибка, загрузка) зелёные; `make e2e` — axe 0 на
1440 и 390, первое событие потока ≤ 1 с.
