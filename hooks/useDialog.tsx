import React, { ReactNode, useCallback, useMemo, useState } from "react";
import { Portal, Dialog as PPDialog, Button } from "react-native-paper";

type Action = {
  label: string;
  onPress?: () => void;
};
export default function useDialog(): [
  ReactNode | null,
  (
    title: string,
    getContent: (onClose: () => void) => ReactNode,
    actions?: Action[]
  ) => void
] {
  const [dialogContent, setDialogContent] = useState<null | {
    title: string;
    content: ReactNode;
    actions?: Action[];
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
          <PPDialog.Actions>
            {dialogContent.actions?.map((action, index) => (
              <Button
                key={index}
                onPress={() => {
                  action.onPress?.();
                  onClose();
                }}
              >
                {action.label}
              </Button>
            ))}
          </PPDialog.Actions>
        </PPDialog>
      </Portal>
    );
  }, [dialogContent, onClose]);

  const showDialog = (
    title: string,
    getContent: (onClose: () => void) => ReactNode,
    actions?: Action[]
  ) => {
    setDialogContent({
      title,
      content: getContent(onClose),
      actions: actions,
    });
  };

  return [Dialog, showDialog];
}
