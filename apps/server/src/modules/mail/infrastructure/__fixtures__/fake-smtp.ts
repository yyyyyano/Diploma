// Поддельный SMTP-сервер для тестов (NFR-11: офлайн): слушает 127.0.0.1 на свободном порту, отвечает «250» на всё и
// складывает полученные письма (сырой текст DATA) в массив. Без TLS и без проверки входа: проверяется, что письмо
// дошло по SMTP, а не протокол Nodemailer.
import { createServer, type Server } from "node:net";

export interface FakeSmtp {
  readonly port: number;
  readonly received: string[];
  close(): Promise<void>;
}

export async function startFakeSmtp(): Promise<FakeSmtp> {
  const received: string[] = [];
  const server: Server = createServer((socket) => {
    let buffer = "";
    let data: string | undefined;
    socket.setEncoding("utf8");
    socket.write("220 fake.test ESMTP\r\n");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        if (data !== undefined) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          received.push(data + buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          data = undefined;
          socket.write("250 OK queued\r\n");
          continue;
        }
        const newline = buffer.indexOf("\r\n");
        if (newline === -1) return;
        const line = buffer.slice(0, newline).toUpperCase();
        buffer = buffer.slice(newline + 2);
        if (line.startsWith("EHLO")) socket.write("250-fake.test\r\n250 8BITMIME\r\n");
        else if (line === "DATA") {
          data = "";
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("нет порта");
  return {
    port: address.port,
    received,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}

/** Тексты частей письма в base64 — раскодированные и склеенные: так тест ищет ссылку и тему в теле. */
export function decodedParts(raw: string): string {
  const parts = raw.split(/\r\n--[^\r\n]+\r\n/);
  return parts
    .map((part) => {
      const [head = "", body = ""] = part.split("\r\n\r\n");
      return /Content-Transfer-Encoding: base64/i.test(head)
        ? Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8")
        : body;
    })
    .join("\n");
}
