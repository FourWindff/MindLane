import { View, StyleSheet } from "react-native";
import FlowNode from "../FlowNode";
import { Connection, FlowNodeAIMeta, FlowNodeMeta } from "../../types";
import { useCallback, useEffect, useRef, useState } from "react";
import { calculateLayout } from "../../utils/dagreLayout";
import Svg from "react-native-svg";
import ConnectionLine from "../FlowNode/ConnectionLine";
import { DRAFT_LENGTH } from "../constants";

interface FlowGraphProps {
  initalNodes: FlowNodeAIMeta[];
  scale: number;
  onNodePress: (id: string, label: string, content: string) => void;
}
export default function FlowGraph({
  initalNodes,
  scale,
  onNodePress,
}: FlowGraphProps) {
  const [nodes, setNodes] = useState<FlowNodeMeta[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [svgBounds, setSvgBounds] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });
  const nodePositions = useRef<Map<string, { x: number; y: number }>>(
    new Map()
  );
  const graphMeta = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // 计算连接线的函数
  const calculateConnections = useCallback(
    (nodes: FlowNodeMeta[]): Connection[] => {
      const newConnections: Connection[] = [];
      nodes.forEach((node) => {
        if (node.childId) {
          node.childId.forEach((childId) => {
            const childNode = nodes.find((n) => n.id === childId);
            if (childNode) {
              newConnections.push({
                id: `${node.id}-${childId}`,
                startX: node.x + node.width,
                startY: node.y + node.height / 2,
                endX: childNode.x,
                endY: childNode.y + childNode.height / 2,
              });
            }
          });
        }
      });
      return newConnections;
    },
    []
  );
  useEffect(() => {
    const { layoutNodes, width, height } = calculateLayout(initalNodes);
    console.log("layoutNode", layoutNodes);

    const flowNodeMeta: FlowNodeMeta[] = layoutNodes.map((node) => {
      const originalNode = initalNodes.find((n) => n.id === node.id);
      return {
        ...node,
        parentId: originalNode?.parentId || [],
        childId: originalNode?.childId || [],
        label: originalNode?.label || `Node ${node.id}`,
        content: originalNode?.content || "",
      };
    });
    console.log("flowNodeMeta", flowNodeMeta);
    flowNodeMeta.map((node) => {
      nodePositions.current.set(node.id, { x: node.x, y: node.y });
    });

    setNodes(flowNodeMeta);
    graphMeta.current = { width: width || 0, height: height || 0 };
    const connectionLines = calculateConnections(flowNodeMeta);
    console.log("connectionLines", connectionLines);
    setConnections(connectionLines);
  }, [calculateConnections, initalNodes]);

  // 计算连接线的边界框
  const calculateSvgBounds = useCallback((connections: Connection[]) => {
    if (connections.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    connections.forEach((conn) => {
      minX = Math.min(minX, conn.startX, conn.endX);
      minY = Math.min(minY, conn.startY, conn.endY);
      maxX = Math.max(maxX, conn.startX, conn.endX);
      maxY = Math.max(maxY, conn.startY, conn.endY);
    });

    // 添加一些边距
    const padding = 20;
    return {
      x: minX - padding,
      y: minY - padding,
      width: maxX - minX + padding * 2,
      height: maxY - minY + padding * 2,
    };
  }, []);

  // 在连接线更新时重新计算边界框
  useEffect(() => {
    setSvgBounds(calculateSvgBounds(connections));
  }, [connections, calculateSvgBounds]);

  // 处理节点位置变化
  const handleNodePositionChange = useCallback(
    (nodeId: string, x: number, y: number) => {
      // 更新节点位置映射
      nodePositions.current.set(nodeId, { x, y });
      // 使用 useAnimatedReaction 来处理连接线更新
      setConnections((prevConnections) => {
        const newConnections = [...prevConnections];
        const currentNode = nodes.find((n) => n.id === nodeId);
        if (!currentNode) return prevConnections;

        // 更新当前节点的子节点连接线
        if (currentNode.childId) {
          currentNode.childId.forEach((childId) => {
            const childNode = nodes.find((n) => n.id === childId);
            if (childNode) {
              const childPos = nodePositions.current.get(childId);
              if (childPos) {
                const connectionIndex = newConnections.findIndex(
                  (conn) => conn.id === `${nodeId}-${childId}`
                );
                if (connectionIndex !== -1) {
                  newConnections[connectionIndex] = {
                    id: `${nodeId}-${childId}`,
                    startX: x + currentNode.width,
                    startY: y + currentNode.height / 2,
                    endX: childPos.x,
                    endY: childPos.y + childNode.height / 2,
                  };
                }
              }
            }
          });
        }

        // 更新当前节点的父节点连接线
        const parentConnections = newConnections.filter((conn) =>
          conn.id.endsWith(`-${nodeId}`)
        );
        parentConnections.forEach((conn) => {
          const parentId = conn.id.split("-")[0];
          const parentNode = nodes.find((n) => n.id === parentId);
          if (parentNode) {
            const parentPos = nodePositions.current.get(parentId);
            if (parentPos) {
              const connectionIndex = newConnections.findIndex(
                (c) => c.id === conn.id
              );
              if (connectionIndex !== -1) {
                newConnections[connectionIndex] = {
                  id: conn.id,
                  startX: parentPos.x + parentNode.width,
                  startY: parentPos.y + parentNode.height / 2,
                  endX: x,
                  endY: y + currentNode.height / 2,
                };
              }
            }
          }
        });
        return newConnections;
      });
    },
    [nodes]
  );

  return (
    <View
      style={[
        styles.container,
        {
          position: "absolute",
          left: DRAFT_LENGTH / 2,
          top: DRAFT_LENGTH / 2,
          width: graphMeta.current.width,
          height: graphMeta.current.height,
          transform: [
            { translateX: -graphMeta.current.width / 2 },
            { translateY: -graphMeta.current.height / 2 },
          ],
        },
      ]}
    >
      <Svg
        style={{
          position: "absolute",
          left: svgBounds.x,
          top: svgBounds.y,
          width: svgBounds.width,
          height: svgBounds.height,
          pointerEvents: "none",
        }}
      >
        {connections.map((cn) => (
          <ConnectionLine
            key={cn.id}
            startX={cn.startX - svgBounds.x}
            startY={cn.startY - svgBounds.y}
            endX={cn.endX - svgBounds.x}
            endY={cn.endY - svgBounds.y}
          />
        ))}
      </Svg>
      {nodes.map((node) => (
        <FlowNode
          key={node.id}
          id={node.id}
          initialX={node.x}
          initialY={node.y}
          scale={scale}
          label={node.label}
          content={node.content}
          onPositionChange={handleNodePositionChange}
          onPress={onNodePress}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
});
