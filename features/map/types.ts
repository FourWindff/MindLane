export type MapNode = {
  order: number;
  x: number;
  y: number;
  data: {
    label: string;
    content: string;
    lane: string;
  };
};
//TODO 取出undefined
export type MapAiResponse = {
  title: string;
  nodes: MapNode[];
};
export type MapDisplayerProps = {
  imageUri: string;
} & MapAiResponse;
