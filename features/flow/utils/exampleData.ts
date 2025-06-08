import { FlowAiResponse } from "../types";

export const FlowExampleData: FlowAiResponse = {
  title: "mock",
  answer: 'answer',
  nodes: [
    {
      id: '1',
      parentId: null,
      childId: ['2'],
      label: 'step1',
      content: 'step1-content'
    },
    {
      id: '2',
      parentId: ['1'],
      childId: ['5'],
      label: 'step2',
      content: 'step2-content'
    },
    {
      id: '3',
      parentId: null,
      childId: ['4'],
      label: 'step3',
      content: 'step3-content'
    },
    {
      id:'4',
      parentId:['3'],
      childId:['5'],
      label:'step4',
      content:'step4-content'
    },
    {
      id: '5',
      parentId: ['2', '4'],
      childId: ['6','7'],
      label: 'step5',
      content: 'step5-content'
    },
    {
      id: '6',
      parentId: ['5'],
      childId: null,
      label: 'step6',
      content: 'step6-content'
    },
    {
      id:'7',
      parentId:['5'],
      childId:['6'],
      label:'step7',
      content:'step7-content'
    }
  ]
}