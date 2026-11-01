// «Ассистент» (design/screens/Assistant.dc.html, MobileChat.dc.html, CHAT-01, CHAT-02, NFR-21): слева — диалоги
// (на телефоне — шторка по кнопке «Диалоги»), справа — шапка с названием диалога и выбором модели, плашка «Локальный
// режим», лента и поле вопроса. Открытый диалог — в адресе (`?c=`), новый — без `c` и создаётся первым вопросом.
// Переписка живёт в ChatView: смена диалога меняет `key` загрузчика, а появление id у нового диалога — только адрес
// и подсветку в списке (иначе идущий ответ оборвался бы перерисовкой).
import type { ConversationId } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ListTree, Plus, Sparkles, TriangleAlert, UserRoundSearch } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { sessionQuery } from "../../lib/session.ts";
import { EmptyState, Sheet, SkeletonText } from "../../ui/index.ts";
import classes from "./AssistantPage.module.css";
import { ChatLoader } from "./ChatLoader.tsx";
import { DialogList } from "./DialogList.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { useCloudGranted } from "./LocalModeBanner.tsx";
import { useInitialConversation } from "./model/use-initial-conversation.ts";
import { useAssistantTexts } from "./model/assistant-texts.ts";
import { useSeen } from "./model/use-seen.ts";
import type { AssistantSearch } from "./model/search.ts";

const PHONE_QUERY = "(max-width: 860px)";

/** Имя для приветствия: у пользователя без имени сессия подставляет email — «Здравствуйте, a@b.by!» не пишем. */
function greetingName(user: { readonly name: string; readonly email: string } | null | undefined) {
  return user === null || user === undefined || user.name === user.email ? undefined : user.name;
}

export function AssistantPage({ search }: { readonly search: AssistantSearch }) {
  useAssistantTexts();
  const { t } = useTranslation("assistant");
  const initial = useInitialConversation(search.c);
  if (initial.status === "error") {
    return (
      <EmptyState
        tone="error"
        headingLevel={1}
        icon={TriangleAlert}
        title={t("historyError.title")}
        description={t("historyError.text")}
        actions={<Button onClick={initial.retry}>{t("historyError.retry")}</Button>}
      />
    );
  }
  if (initial.status === "pending") {
    return (
      <div className={classes.wait}>
        <SkeletonText lines={4} />
      </div>
    );
  }
  return <Layout initial={initial.id} />;
}

interface Opened {
  /** Растёт при выборе другого диалога: по нему ChatLoader перемонтируется. */
  readonly key: number;
  readonly target: ConversationId | null;
}

function Layout({ initial }: { readonly initial: ConversationId | null }) {
  const { t } = useTranslation("assistant");
  const navigate = useNavigate();
  const router = useRouter({ warn: false });
  const isPhone = useMediaQuery(PHONE_QUERY) === true;
  const [opened, setOpened] = useState<Opened>({ key: 0, target: initial });
  // Id диалога сейчас: у нового появляется с первым ответом — ChatLoader при этом не перемонтируется.
  const [activeId, setActiveId] = useState<ConversationId | null>(initial);
  const [listOpen, setListOpen] = useState(false);
  const seen = useSeen();
  const conversations = useQuery(orpc.chat.conversations.queryOptions());
  const session = router?.options.context.session;
  const user = useQuery({
    ...sessionQuery(session ?? { current: async () => undefined, signOut: async () => {} }),
    enabled: session !== undefined,
  });
  const cloudGranted = useCloudGranted();

  const show = useCallback(
    (id: ConversationId | null, remount: boolean) => {
      setActiveId(id);
      if (remount) setOpened((current) => ({ key: current.key + 1, target: id }));
      setListOpen(false);
      void navigate({
        to: "/assistant",
        search: id === null ? {} : { c: id },
        replace: true,
      });
    },
    [navigate],
  );
  const open = useCallback((id: ConversationId) => show(id, true), [show]);
  const start = useCallback(() => show(null, true), [show]);
  const named = useCallback((id: ConversationId) => show(id, false), [show]);

  const title =
    activeId === null
      ? t("dialogs.untitled")
      : (conversations.data?.items.find((item) => item.id === activeId)?.title ??
        t("dialogs.untitled"));
  const list = (
    <DialogList activeId={activeId} onOpen={open} onNew={start} cloudNote={cloudGranted === true} />
  );

  return (
    <div className={classes.wrap}>
      <aside className={classes.list}>{list}</aside>
      <section className={classes.chat}>
        <header className={classes.head}>
          <span className={classes.avatar}>
            <Sparkles size={20} strokeWidth={1.8} aria-hidden />
          </span>
          <div className={classes.headText}>
            <h1 className={classes.title}>{title}</h1>
            <p className={classes.sub}>{t("head.sub")}</p>
            <p className={classes.seen}>{t("mobile.context", { page: seen.label })}</p>
          </div>
          <div className={classes.headActions}>
            <Button
              className={classes.phoneOnly}
              variant="default"
              size="sm"
              leftSection={<ListTree size={16} strokeWidth={1.8} aria-hidden />}
              onClick={() => setListOpen(true)}
            >
              {t("dialogs.open")}
            </Button>
            <Button
              className={classes.phoneOnly}
              variant="default"
              size="sm"
              leftSection={<Plus size={16} strokeWidth={1.8} aria-hidden />}
              onClick={start}
            >
              {t("dialogs.newDialog")}
            </Button>
            <ModelPicker />
            <Link to="/memory" className={classes.memory}>
              <UserRoundSearch size={16} strokeWidth={1.8} aria-hidden />
              {t("head.memory")}
            </Link>
          </div>
        </header>
        <ChatLoader
          key={opened.key}
          variant="page"
          conversationId={opened.target}
          getPage={() => seen.context}
          onConversation={named}
          userName={greetingName(user.data)}
        />
      </section>
      {isPhone && (
        <Sheet
          opened={listOpen}
          onClose={() => setListOpen(false)}
          title={t("dialogs.label")}
          position="bottom"
        >
          {list}
        </Sheet>
      )}
    </div>
  );
}
