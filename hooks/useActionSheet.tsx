// import React, { ReactNode, useCallback, useMemo, useState } from "react";

// export default function useActionSheet(): [
//   ReactNode | null,
//   (showActions: (onClose: () => void) => ReactNode) => void
// ] {
//   const [actionsContent, setActionsContent] = useState<null | {
//     content: ReactNode
//   }>(null);

//   const onClose = useCallback(() => {
//     setActionsContent(null);
//   }, []);

//   const ActionSheet = useMemo(() => {
//     if (actionsContent === null) {
//       return null;
//     }
//     const { content } = actionsContent;

//     return (
//       <Sheet onDismiss={onClose}>
//         {content}
//       </Sheet>
//     )
//   }, [actionsContent, onClose]);

//   const showActionSheet = useCallback((
//     getContent: (onClose: () => void) => ReactNode,
//   ) => {
//     setActionsContent({ content: getContent(onClose) })
//   }, [onClose])

//   return [ActionSheet, showActionSheet];
// }
