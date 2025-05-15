export type FlowNode={
    id:string
    parentId:string;
    childId:string;
    label:string;
    content:string;
}
export type FlowAiResponse = {
    createAt:number;
    title:string;
    answer:string;
    node:FlowNode[];
}
export type FlowDisplayerProps = FlowAiResponse 

