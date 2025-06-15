import React from 'react';
import Animated, {
  SharedValue,
  useAnimatedStyle
} from 'react-native-reanimated';
import { Line } from 'react-native-svg';


export interface ArrowProps { // Export the interface
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  color?: string;
  strokeWidth?: number | string;
  markerSize?: number;
  markerId: string;
  progress: SharedValue<number>;
  startRatio: number;
  endRatio: number;
  segmentLength: number; // Add segment length
  totalLength: number; // Add total length
  beamLength: number; // Add beam length
  // dashLength and dashGap are no longer needed for the beam effect
  // dashLength: number;
  // dashGap: number;
}

const AnimatedLine = Animated.createAnimatedComponent(Line);

export default function Arrow({
  start,
  end,
  color = '#4A90E2',
  strokeWidth = 2,
  markerId,
  progress,
  startRatio,
  endRatio,
  segmentLength,
  totalLength,
  beamLength,
}: ArrowProps) {
  const animatedProps = useAnimatedStyle(() => {
    const animatedProgress = progress.value;

    // Calculate the start and end position of the beam based on global progress
    const beamStartGlobal = animatedProgress * totalLength - beamLength / 2;
    const beamEndGlobal = animatedProgress * totalLength + beamLength / 2;

    // Calculate the start and end position of the current segment in global path length
    const segmentStartGlobal = startRatio * totalLength;
    const segmentEndGlobal = endRatio * totalLength;

    // Determine the visible portion of the beam within this segment
    const visibleStart = Math.max(segmentStartGlobal, beamStartGlobal);
    const visibleEnd = Math.min(segmentEndGlobal, beamEndGlobal);

    // If the beam is not within this segment, hide it
    if (visibleStart >= visibleEnd) {
      return {
        strokeDasharray: [0, segmentLength], // Hide the line
        strokeDashoffset: 0,
        opacity: 0,
      };
    }

    // Calculate the length of the visible portion of the beam in this segment
    const visibleLength = visibleEnd - visibleStart;

    // Calculate the offset for the dash array
    // The dash array will be [visibleLength, segmentLength - visibleLength]
    // The offset determines where the visible portion starts
    const dashOffset = segmentLength - (visibleStart - segmentStartGlobal);

    // Simple opacity based on whether the beam is visible in this segment
    const opacity = visibleLength > 0 ? 1 : 0;


    return {
      strokeDasharray: [visibleLength, segmentLength - visibleLength],
      strokeDashoffset: dashOffset,
      opacity,
    };
  }, [startRatio, endRatio, segmentLength, totalLength, beamLength, progress]); // Added dependencies

  return (
    <AnimatedLine
      x1={start.x}
      y1={start.y}
      x2={end.x}
      y2={end.y}
      stroke={color}
      strokeWidth={strokeWidth}
      markerEnd={`url(#${markerId})`}
      // @ts-ignore - AnimatedLine doesn't properly type animated styles
      style={animatedProps}
    />
  );
}
