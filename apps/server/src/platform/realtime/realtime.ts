// Живые сигналы (NFR-21, ADR-0008, ARCHITECTURE §5): «данные изменились» и «как идёт фоновая работа» — из любого
// процесса в браузеры домохозяйства. Отправка есть у всех ролей: changed(s, …) — через s.db, внутри
// s.transaction сигнал уходит при COMMIT (откат — сигнала нет); progress(scope, …) — сразу через пул, вне
// транзакции данных. Домохозяйство сигнала — всегда scope вызывающего. Приём (LISTEN → хаб → events.stream) —
// только в api: createRealtimeStreams. В сигнале — вид, сущность и id, без данных (OBS-04).
import type { Scope } from "@kosht/kernel";
import { notify, type ListenConnect } from "../db/listen.ts";
import type { ScopedDb } from "../db/scoped-db.ts";
import { createSystemDb } from "../db/system-db.ts";
import type { Logger } from "../logging/logger.ts";
import { createRealtimeHub, type EventStreams, type RealtimeHub } from "./hub.ts";
import { createRealtimeListener, type RealtimeListener } from "./listener.ts";
import { encodeSignal } from "./message.ts";

/** Пул роли приложения (тот же тип, что принимает createSystemDb: pg сюда не импортируется). */
export type RealtimePool = Parameters<typeof createSystemDb>[0];

export interface ChangedSignal {
  /** Короткое машинное имя сущности в kebab-case (как EntityKind контракта). */
  readonly entity: string;
  readonly ids: readonly string[];
}

export interface ProgressSignal {
  readonly entity: string;
  readonly id: string;
  /** Доля готовности 0…100; нет — если неизвестна. */
  readonly percent?: number;
}

export interface Realtime {
  /** Объекты изменились: в транзакции s — при её коммите; пачка режется на куски NOTIFY. */
  changed(s: ScopedDb, signal: ChangedSignal): Promise<void>;
  /** Ход фоновой работы — сразу, мимо транзакций данных. */
  progress(scope: Scope, signal: ProgressSignal): Promise<void>;
}

export function createRealtime(deps: { readonly pool: RealtimePool }): Realtime {
  const system = createSystemDb(deps.pool);
  return {
    async changed(s, { entity, ids }) {
      const householdId = s.scope.householdId;
      await notify(s.db, encodeSignal({ householdId, type: "changed", entity, ids }));
    },
    async progress(scope, { entity, id, percent }) {
      const householdId = scope.householdId;
      await notify(
        system,
        encodeSignal({
          householdId,
          type: "progress",
          entity,
          ids: [id],
          ...(percent === undefined ? {} : { percent }),
        }),
      );
    },
  };
}

export interface RealtimeStreamsDeps {
  /** Подключение LISTEN (listenConnector роли api). */
  readonly connect: ListenConnect;
  readonly log: Logger;
}

export interface RealtimeStreams {
  /** Потоки для процедуры events.stream; size — сколько открыто (тесты, диагностика). */
  readonly streams: EventStreams & { readonly size: number };
  /** Первое подключение LISTEN; неудача — RealtimeStartError (ошибка старта процесса). */
  start(): Promise<void>;
  /** Закрыть потоки, затем LISTEN без переподключения (realtime.stopped). */
  stop(): Promise<void>;
}

/** Приём сигналов в api: одно соединение LISTEN на процесс и хаб потоков. */
export function createRealtimeStreams(deps: RealtimeStreamsDeps): RealtimeStreams {
  const hub: RealtimeHub = createRealtimeHub({ log: deps.log });
  const listener: RealtimeListener = createRealtimeListener({
    connect: deps.connect,
    log: deps.log,
    onMessage: (message) => hub.deliver(message),
    // Пока LISTEN не было, сигналы терялись: потоки (и открытые во время разрыва) закрываются, клиент
    // переподключается и перезапрашивает данные.
    onReady: () => hub.closeAll("reconnect"),
  });
  return {
    streams: hub,
    start: () => listener.start(),
    async stop() {
      hub.closeAll("stopped");
      await listener.stop();
    },
  };
}
