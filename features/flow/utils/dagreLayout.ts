import dagre from '@dagrejs/dagre';
import { FlowAiResponse, FlowNodeAIMeta, FlowNodeLayoutMeta } from '../FlowDisplayer';
import { NODE_HEIGHT, NODE_WIDTH } from '../components/constants';


export const calculateLayout = (nodes: FlowNodeAIMeta[]) => {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: 'LR',  // 改为从左到右的布局 (LR = Left to Right)
    nodesep: 80,    // 增加节点之间的水平间距
    ranksep: 100,   // 增加层级之间的垂直间距
    marginx: 50,    // 增加水平边距
    marginy: 50,    // 增加垂直边距
    align: 'UL',    // 对齐方式：上左对齐
    acyclicer: 'greedy',  // 处理循环的算法
    ranker: 'network-simplex'  // 层级排序算法
  });
  g.setDefaultEdgeLabel(() => ({}));

  // 添加节点
  nodes.forEach(node => {
    g.setNode(node.id, {
      width: NODE_WIDTH,  // 节点宽度
      height: NODE_HEIGHT  // 节点高度
    });
  });

  // 添加边
  nodes.forEach(node => {
    if (node.childId) {
      node.childId.forEach(childId => {
        g.setEdge(node.id, childId);
      });
    }
  });

  // 计算布局
  dagre.layout(g);


  // 转换布局结果
  const layoutNodes: FlowNodeLayoutMeta[] = [];

  g.nodes().forEach(nodeId => {
    const node = g.node(nodeId);
    if (node && typeof node.x === 'number' && typeof node.y === 'number') {
      layoutNodes.push({
        id: nodeId,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height
      });
    }
  });
  const width = g.graph().width;
  const height = g.graph().height;
  return { 
    layoutNodes, 
    width, 
    height 
  };
}; 