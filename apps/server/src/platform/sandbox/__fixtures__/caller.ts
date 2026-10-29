// Вызывающий код для проверки сборки: собранный бандл запускает рабочий файл рядом с собой (isolated.ts, workerUrl).
import { defineIsolatedWorker, runIsolated } from "../isolated.ts";

const echo = defineIsolatedWorker({
  name: "echo",
  devUrl: new URL("./echo.worker.ts", import.meta.url),
});

const result = await runIsolated<unknown, { text: string }>(
  echo,
  { mode: "echo", text: "из бандла" },
  { timeoutMs: 5_000, memoryMb: 64 },
);
process.stdout.write(`${result.text}\n`);
