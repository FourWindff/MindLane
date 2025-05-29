import React, {useEffect, useMemo} from 'react';
import {Easing, useSharedValue, withRepeat, withTiming} from 'react-native-reanimated';
import Svg, {Defs, Marker as SvgMarker, Polygon} from 'react-native-svg';
import Arrow from './Arrow'; // Import ArrowProps
import {Node} from "./index";

export interface ArrowsGroupProps {
  nodes: Node[];
  scaleX: number;
  scaleY: number;
  color?: string;
  strokeWidth?: number | string;
  markerSize?: number;
  beamLengthRatio?: number; // Add beamLengthRatio to the interface
}

export default function ArrowsGroup({
  nodes = [],
  scaleX = 1,
  scaleY = 1,
  color = '#4A90E2',
  strokeWidth = 2,
  markerSize = 7,
  beamLengthRatio = 0.1, // Add prop for beam length ratio
}: ArrowsGroupProps) {
  const progress = useSharedValue(0);

  // 对节点按order排序
  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => a.order - b.order);
  }, [nodes]);

  // 生成连接线
  const connections = useMemo(() => {
    if (sortedNodes.length < 2) return [];

    return sortedNodes.slice(0, -1).map((startNode, i) => ({
      id: `conn-${i}`,
      start: {
        x: startNode.x * scaleX,
        y: startNode.y * scaleY,
      },
      end: {
        x: sortedNodes[i + 1].x * scaleX,
        y: sortedNodes[i + 1].y * scaleY,
      },
    }));
  }, [sortedNodes, scaleX, scaleY]);

  const markerId = 'arrowhead' + Math.random().toString(36).slice(2, 11);
  const markerHeight = markerSize * 0.7; // 箭头高度与宽度的比例
  const hasConnections = connections.length > 0;

  // Animation effect
  useEffect(() => {
    if (!hasConnections) return;

    // Reset progress
    progress.value = 0;
    
    // Create smooth continuous animation
    // Start animation
    progress.value = withRepeat(
      withTiming(1, {
        duration: 4000, // Duration for one complete cycle, increased for slower start/end
        easing: Easing.inOut(Easing.cubic), // Roller coaster easing
      }),
      -1, // Infinite loop
      false
    );

    // 清理函数
    return () => {
      progress.value = 0;
    };
  }, [progress, hasConnections]); // Removed connections.length from dependency array

  // 计算路径总长度
  const calculatePathLength = (start: {x: number, y: number}, end: {x: number, y: number}) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 计算所有连接线的总长度
  const totalLength = useMemo(() => {
    if (!hasConnections) return 0;
    return connections.reduce((sum, conn) => {
      return sum + calculatePathLength(conn.start, conn.end);
    }, 0);
  }, [connections, hasConnections]);

  // 计算每条线在总长度中的比例
  const connectionsWithRatio = useMemo(() => {
    if (!hasConnections || totalLength === 0) return []; // Handle totalLength being 0

    let currentLength = 0;
    return connections.map((conn, index) => {
      const length = calculatePathLength(conn.start, conn.end);
      const startRatio = totalLength > 0 ? currentLength / totalLength : 0;
      const endRatio = totalLength > 0 ? (currentLength + length) / totalLength : 0;
      currentLength += length;

      // 确保每条线都有唯一的ID
      const id = `conn-${index}`;

      return {
        ...conn,
        id,
        startRatio,
        endRatio,
        length: length // Use actual length
      };
    });
  }, [connections, totalLength, hasConnections]);

  if (!hasConnections || connectionsWithRatio.length === 0 || totalLength === 0) return null; // Handle totalLength being 0

  const beamLength = totalLength * beamLengthRatio; // Calculate beam length

  return (
    <Svg width="100%" height="100%" pointerEvents="none">
      <Defs>
        <SvgMarker
          id={markerId}
          markerWidth={markerSize}
          markerHeight={markerHeight}
          refX={markerSize - 1}
          refY={markerHeight / 2}
          orient="auto"
        >
          <Polygon
            points={`0,0 ${markerSize},${markerHeight / 2} 0,${markerHeight}`}
            fill={color}
          />
        </SvgMarker>
      </Defs>

      {connectionsWithRatio.map((conn) => (
        <Arrow
          key={conn.id}
          id={conn.id}
          start={conn.start}
          end={conn.end}
          color={color}
          strokeWidth={strokeWidth}
          markerId={markerId}
          markerSize={markerSize}
          progress={progress}
          startRatio={conn.startRatio}
          endRatio={conn.endRatio}
          segmentLength={conn.length} // Pass segment length
          totalLength={totalLength} // Pass total length
          beamLength={beamLength} // Pass beam length
          // dashLength and dashGap are no longer needed for the beam effect
          // dashLength={Math.max(12, conn.length * 0.4)}
          // dashGap={Math.max(6, conn.length * 0.3)}
        />
      ))}
    </Svg>
  );
};
