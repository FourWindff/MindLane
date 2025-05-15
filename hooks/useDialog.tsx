import React, { ReactNode, useCallback, useMemo, useState } from "react";
import { Portal, Dialog as PPDialog } from "react-native-paper";


export default function useDialog(): [
  ReactNode | null,
  (title: string, showDialog: (onClose: () => void) => ReactNode) => void
] {
  const [dialogContent, setDialogContent] = useState<null | {
    title: string,
    content: ReactNode
  }>(null);

  const onClose = useCallback(() => {
    setDialogContent(null);
  }, []);

  const Dialog = useMemo(() => {
    if (dialogContent === null) {
      return null;
    }
    const { title, content } = dialogContent;
    return (
      <Portal>
        <PPDialog visible={true} onDismiss={onClose}>
          <PPDialog.Title>{title}</PPDialog.Title>
          <PPDialog.Content>{content}</PPDialog.Content>
        </PPDialog>
      </Portal>
    )
  }, [dialogContent, onClose]);

  const showDialog = useCallback((
    title: string,
    getContent: (onClose: () => void) => ReactNode,
  ) => {
    setDialogContent({ title, content: getContent(onClose) })
  }, [onClose])

  return [Dialog, showDialog];
}