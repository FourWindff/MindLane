import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';
import { calculateConnectionPath, pointsToPath } from '../../utils/connectionCurve';

interface ConnectionLineProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  color?: string;
  strokeWidth?: number;
  circleRadius?: number;
}

function ConnectionLine({
  startX,
  startY,
  endX,
  endY,
  color = '#666',
  strokeWidth = 2,
  circleRadius = 4,
}: ConnectionLineProps) {
  console.log(startX, startY, endX, endY, "连接线更新")
  const points =
    pointsToPath(calculateConnectionPath(
      { x: startX, y: startY },
      { x: endX, y: endY }))

  return (
    <Svg>
      <Circle
        cx={startX}
        cy={startY}
        r={circleRadius}
        fill={color}
      />
      <Path
        d={points}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <Circle
        cx={endX}
        cy={endY}
        r={circleRadius}
        fill={color}
      />
    </Svg>
  );
}
export default React.memo(ConnectionLine)
