import React, { ReactNode, useCallback, useMemo, useState } from "react";
import { Portal, Modal as PPModal } from "react-native-paper";


export default function useActionSheet(): [
  ReactNode | null,
  (showActions: (onClose: () => void) => ReactNode) => void
] {
  const [actionsContent, setActionsContent] = useState<null | {
    content: ReactNode
  }>(null);

  const onClose = useCallback(() => {
    setActionsContent(null);
  }, []);

  const Dialog = useMemo(() => {
    if (actionsContent === null) {
      return null;
    }
    const { content } = actionsContent;
    const containerStyle = {
      backgroundColor: 'white',
      padding: 20,
      borderRadius: 10,
    };
    return (
      <Portal>
        <PPModal visible={true} contentContainerStyle={containerStyle} onDismiss={onClose}>{content}</PPModal>
      </Portal>
    )
  }, [actionsContent, onClose]);

  const showActionSheet = useCallback((
    getContent: (onClose: () => void) => ReactNode,
  ) => {
    setActionsContent({ content: getContent(onClose) })
  }, [onClose])

  return [Dialog, showActionSheet];
}
