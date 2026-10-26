// «Записал… [Отменить]» (P5, AGT-05): UndoToast дизайн-системы, подключённый к actions.undo по undoToken из ответа
// действия. Итог — странице (onResult): отменено, уже было отменено или ошибка (CONFLICT — объект уже правили).
import type { UndoToken } from "@kosht/contract";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { z } from "zod";
import { orpc } from "../../lib/api.ts";
import { UndoToast } from "../../ui/index.ts";

export type UndoResult = { readonly ok: true } | { readonly ok: false; readonly error: unknown };

export interface UndoActionToastProps {
  readonly token: z.infer<typeof UndoToken>;
  readonly message: ReactNode;
  readonly opened: boolean;
  readonly onClose: () => void;
  readonly onResult?: (result: UndoResult) => void;
}

export function UndoActionToast({
  token,
  message,
  opened,
  onClose,
  onResult,
}: UndoActionToastProps) {
  const undo = useMutation(
    orpc.actions.undo.mutationOptions({
      onSuccess: () => onResult?.({ ok: true }),
      onError: (error) => onResult?.({ ok: false, error }),
    }),
  );
  return (
    <UndoToast
      opened={opened}
      message={message}
      onClose={onClose}
      onUndo={() => undo.mutate({ token })}
    />
  );
}
