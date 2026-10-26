// Локальный почтовый ящик (design/screens/Mailbox.dc.html, AUTH-06): только для демо и разработки, только на этом
// компьютере (на сетевом входе сервер отвечает NOT_FOUND — показываем ошибку). Слева — входящие (новые сверху, точка
// у непрочитанных в этом окне), справа — письмо: тема, от/кому/когда, текст, кнопка-ссылка, ссылка целиком и пометка.
// Тексты писем приходят с сервера готовыми полями (без HTML). Почта настроена — ящик выключен, так и сказано.
import type { MailboxMessage } from "@kosht/contract";
import { formatDate } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Inbox, Info, MailCheck, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { EmptyState, Logo, SkeletonList } from "../../ui/index.ts";
import classes from "./MailboxPage.module.css";

export function MailboxPage() {
  const { t } = useTranslation("mailbox");
  const box = useQuery(orpc.mail.mailbox.queryOptions());
  const messages = box.data?.messages ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [read, setRead] = useState<ReadonlySet<string>>(new Set());
  const selected = messages.find((m) => m.id === selectedId) ?? messages[0];
  const isRead = (m: MailboxMessage) => read.has(m.id) || m.id === selected?.id;
  const unread = messages.filter((m) => !isRead(m)).length;

  function open(message: MailboxMessage) {
    // Письмо, открытое до этого (в том числе первое — оно открыто сразу), остаётся прочитанным.
    const shown = selected?.id;
    setSelectedId(message.id);
    setRead((prev) => {
      const next = new Set(prev).add(message.id);
      return shown === undefined ? next : next.add(shown);
    });
  }

  let content;
  if (box.isPending) {
    content = <SkeletonList rows={4} />;
  } else if (box.isError) {
    content = (
      <EmptyState
        tone="error"
        icon={AlertTriangle}
        title={t("error.title")}
        description={t("error.text")}
        actions={<Button onClick={() => void box.refetch()}>{t("error.retry")}</Button>}
      />
    );
  } else if (!box.data.enabled) {
    content = <EmptyState icon={MailCheck} title={t("off.title")} description={t("off.text")} />;
  } else if (selected === undefined) {
    content = <EmptyState icon={Inbox} title={t("empty.title")} description={t("empty.text")} />;
  } else {
    content = (
      <div className={classes.grid}>
        <section className={classes.list} aria-labelledby="mailbox-inbox">
          <header className={classes.listHead}>
            <h2 id="mailbox-inbox">{t("inbox")}</h2>
            <span className={classes.counter}>
              {unread === 0 ? t("allRead") : t("unread", { count: unread })}
            </span>
          </header>
          <ul>
            {messages.map((message) => (
              <li key={message.id}>
                <button
                  type="button"
                  className={classes.item}
                  aria-current={message.id === selected.id}
                  data-unread={!isRead(message)}
                  onClick={() => open(message)}
                >
                  {!isRead(message) && <span className={classes.dot} title={t("unreadMark")} />}
                  <span className={classes.itemTop}>
                    <span>{message.to}</span>
                    <time dateTime={message.sentAt}>{sentDay(message.sentAt)}</time>
                  </span>
                  <span className={classes.subject}>{message.subject}</span>
                  <span className={classes.preview}>{message.preview}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <Letter message={selected} />
      </div>
    );
  }

  return (
    <div className={classes.page}>
      <header className={classes.top}>
        <Logo />
        <div className={classes.titles}>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className={classes.actions}>
          <Button
            variant="default"
            leftSection={<RefreshCw size={16} strokeWidth={1.8} aria-hidden />}
            loading={box.isFetching && !box.isPending}
            onClick={() => void box.refetch()}
          >
            {t("refresh")}
          </Button>
          <Button variant="subtle" component={Link} to="/login">
            {t("toLogin")}
          </Button>
        </div>
      </header>
      <p className={classes.banner}>
        <AlertTriangle size={18} strokeWidth={1.8} aria-hidden />
        <span>
          <strong>{t("bannerStrong")}</strong> {t("bannerText")}
        </span>
      </p>
      <main className={classes.body}>{content}</main>
    </div>
  );
}

function Letter({ message }: { readonly message: MailboxMessage }) {
  const { t } = useTranslation("mailbox");
  return (
    <article className={classes.letter} aria-labelledby="mailbox-subject">
      <header className={classes.letterHead}>
        <h2 id="mailbox-subject">{message.subject}</h2>
        <dl>
          <dt>{t("from")}</dt>
          <dd>{t("fromValue")}</dd>
          <dt>{t("to")}</dt>
          <dd>{message.to}</dd>
          <dt>{t("when")}</dt>
          <dd>
            <time dateTime={message.sentAt}>{sentDay(message.sentAt)}</time>
          </dd>
        </dl>
      </header>
      <div className={classes.mailBody}>
        <div className={classes.mail}>
          <div className={classes.mailBrand}>
            <Logo on="dark" />
          </div>
          <div className={classes.mailText}>
            <h3>{message.title}</h3>
            {message.paragraphs.map((text, index) => (
              <p key={`${String(index)}:${text}`}>{text}</p>
            ))}
            {message.action !== null && (
              <>
                <Button
                  component="a"
                  href={message.action.url}
                  size="md"
                  className={classes.action}
                >
                  {message.action.label}
                </Button>
                <p className={classes.copyHint}>{t("copyHint")}</p>
                <p className={classes.url}>{message.action.url}</p>
              </>
            )}
            {message.note !== null && (
              <p className={classes.note} data-kind={message.note.kind}>
                {message.note.kind === "warn" ? (
                  <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />
                ) : (
                  <Info size={16} strokeWidth={1.8} aria-hidden />
                )}
                {message.note.text}
              </p>
            )}
          </div>
          <p className={classes.mailFooter}>{t("footer")}</p>
        </div>
      </div>
    </article>
  );
}

/**
 * День отправки «21.10.2026» (DES-17). Пояс — системный по умолчанию (NFR-23): настройку пояса сайт не читает, а
 * время суток не показываем — отдельного формата времени в @kosht/i18n нет, порядок писем и так новые сверху.
 */
function sentDay(iso: string): string {
  return formatDate(LocalDate.fromInstant(new Date(iso), DEFAULT_TIME_ZONE));
}
