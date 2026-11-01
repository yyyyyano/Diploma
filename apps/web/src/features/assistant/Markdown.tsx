// Ответ модели как Markdown (SEC-05, CHAT-02): без сырого HTML (rehype-raw не подключён, `skipHtml`), без картинок, ссылки —
// только внутренние (`/…`) и https://pravo.by. Всё остальное (чужие адреса, `javascript:`, `data:`, `//host`) остаётся
// текстом без ссылки: модель могла повторить приказ из документа, а картинка по чужому адресу — канал утечки (SEC-10).
import { useRouter } from "@tanstack/react-router";
import type { MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import classes from "./Markdown.module.css";

const PRAVO_HOSTS = new Set(["pravo.by", "www.pravo.by"]);

function hasControlOrBackslash(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

export type LinkKind = "internal" | "pravo" | "blocked";

/** Разрешена ли ссылка ответа: внутренний путь сайта или https на pravo.by; остальное — запрещено. */
export function linkKind(href: string): LinkKind {
  const text = href.trim();
  // «//host» и «/\host» браузер читает как чужой адрес; управляющие знаки в адресе — приём обхода проверок.
  if (hasControlOrBackslash(text)) return "blocked";
  if (text.startsWith("/")) return text.startsWith("//") ? "blocked" : "internal";
  try {
    const url = new URL(text);
    if (url.protocol === "https:" && url.username === "" && url.password === "") {
      return PRAVO_HOSTS.has(url.hostname) ? "pravo" : "blocked";
    }
  } catch {
    // Не адрес: относительная ссылка вида «operations» тоже не внутренний путь сайта.
  }
  return "blocked";
}

/** Адреса для react-markdown: запрещённый — `null` (ссылка теряет href и остаётся текстом). */
export function transformUrl(url: string): string | null {
  return linkKind(url) === "blocked" ? null : url;
}

function Anchor({
  href,
  children,
}: {
  readonly href?: string | undefined;
  readonly children?: React.ReactNode;
}) {
  const router = useRouter({ warn: false });
  if (href === undefined) return <span>{children}</span>;
  if (linkKind(href) === "internal") {
    const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        router === undefined ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.button !== 0
      ) {
        return;
      }
      event.preventDefault();
      router.history.push(href);
    };
    return (
      <a href={href} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const COMPONENTS: Components = {
  a: Anchor,
  // Заголовки ответа — на уровень ниже заголовка страницы: h1 страницы один (доступность).
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
};

export function Markdown({ children }: { readonly children: string }) {
  return (
    <div className={classes.md}>
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        unwrapDisallowed
        urlTransform={transformUrl}
        components={COMPONENTS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
