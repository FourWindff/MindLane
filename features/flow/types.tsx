export type FlowNodeAIMeta = {
  id: string;
  parentId: string[] | null;
  childId: string[] | null;
  label: string;
  content: string;
};
export type FlowNodeLayoutMeta = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type FlowNodeMeta = FlowNodeAIMeta & FlowNodeLayoutMeta;
export type FlowAiResponse = {
  title: string;
  answer: string;
  nodes: FlowNodeAIMeta[];
};

export type FlowDisplayerProps = FlowAiResponse & { imageUri: string };

export type Connection = {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
};
