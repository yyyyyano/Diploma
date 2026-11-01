// Ответ модели как Markdown (SEC-05, CHAT-02): без сырого HTML (rehype-raw не подключён, `skipHtml`), без картинок, ссылки —
// только внутренние (`/…`) и https://pravo.by. Всё остальное (чужие адреса, `javascript:`, `data:`, `//host`) остаётся
// текстом без ссылки: модель могла повторить приказ из документа, а картинка по чужому адресу — канал утечки (SEC-10).
import { useRouter } from "@tanstack/react-router";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";
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

/** Ссылка на цитату правового ответа (`cite:3`, CHAT-05): сервер ставит их вместо меток, чип рисует `renderCite`. */
const CITE = /^cite:(\d{1,3})$/;

type RenderCite = (n: number) => ReactNode;

/**
 * Чипы рисует функция из контекста, а не замыкание в `components`: у `components` постоянные компоненты, и чип (его
 * раскрытая цитата) не теряет состояние, когда ответ перерисовывается по мере потока.
 */
const CiteContext = createContext<RenderCite | undefined>(undefined);

function CiteAnchor({
  href,
  children,
}: {
  readonly href?: string | undefined;
  readonly children?: ReactNode;
}) {
  const renderCite = useContext(CiteContext);
  const match = href === undefined ? null : CITE.exec(href);
  if (renderCite !== undefined && match?.[1] !== undefined)
    return <>{renderCite(Number(match[1]))}</>;
  return <Anchor href={href}>{children}</Anchor>;
}

const COMPONENTS_WITH_CITES: Components = { ...COMPONENTS, a: CiteAnchor };

const transformWithCites = (url: string): string | null =>
  CITE.test(url) ? url : transformUrl(url);

export interface MarkdownProps {
  readonly children: string;
  /**
   * Правовой ответ: `[3](cite:3)` рисуется чипом статьи. Без этого свойства адрес `cite:…` — запрещённая ссылка, как
   * любая чужая схема: в обычном ответе модели чипов быть не может.
   */
  readonly renderCite?: RenderCite | undefined;
}

export function Markdown({ children, renderCite }: MarkdownProps) {
  const cites = renderCite !== undefined;
  return (
    <CiteContext value={renderCite}>
      <div className={classes.md}>
        <ReactMarkdown
          skipHtml
          disallowedElements={["img"]}
          unwrapDisallowed
          urlTransform={cites ? transformWithCites : transformUrl}
          components={cites ? COMPONENTS_WITH_CITES : COMPONENTS}
        >
          {children}
        </ReactMarkdown>
      </div>
    </CiteContext>
  );
}
