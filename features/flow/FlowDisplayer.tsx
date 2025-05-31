export type FlowNode = {
    id: string
    parentId: string[] | null;
    childId: string[] | null;
    label: string;
    content: string;
}
export type FlowAiResponse = {
    createAt: number;
    title: string;
    answer: string;
    nodes: FlowNode[];
}

export type FlowDisplayerProps = FlowAiResponse

