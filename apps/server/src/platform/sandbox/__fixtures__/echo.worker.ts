// Рабочий файл тестов песочницы: режим во входе — вернуть ввод, зависнуть, съесть память, отказать по правилу, упасть.
import { SandboxRejection } from "../isolated.ts";
import { serveIsolated } from "../serve.ts";

interface EchoInput {
  readonly mode: "echo" | "hang" | "memory" | "reject" | "throw" | "bytes";
  readonly text?: string;
  readonly bytes?: Uint8Array;
}

serveIsolated(async (input: EchoInput) => {
  switch (input.mode) {
    case "echo":
      return { text: input.text };
    case "bytes":
      return { size: input.bytes?.byteLength };
    case "hang":
      // Занятый цикл: поток не отвечает на сообщения, остановить его может только terminate().
      for (;;) await new Promise((resolve) => setImmediate(resolve));
    case "memory": {
      const hoard: number[][] = [];
      for (;;) hoard.push(Array.from({ length: 1_000_000 }, () => 1));
    }
    case "reject":
      throw new SandboxRejection("zip-bomb");
    case "throw":
      throw new Error("секрет из документа");
  }
});
