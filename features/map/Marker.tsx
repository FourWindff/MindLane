import React, { useEffect } from 'react';
import { Pressable, StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Node } from "./MapDisplayer";

interface MarkerProps {
  isSelected: boolean;
  offsetX: number;
  offsetY: number;
  onSelect: (node: Node) => void;
  node: Node;
}

export default function Marker({ isSelected, offsetX, offsetY, onSelect, node }: MarkerProps) {
  const fadeAnim = useSharedValue(0.2);
  const rotateAnim = useSharedValue(0);

  useEffect(() => {
    fadeAnim.value = withRepeat(
      withTiming(0.7, { duration: 1000, easing: Easing.linear }),
      -1,
      true
    );
    rotateAnim.value = withRepeat(
      withTiming(360, { duration: 2000, easing: Easing.linear }),
      -1,
    );
  }, [fadeAnim, rotateAnim]);

  const markerStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: `rgba(255, 255, 255, ${fadeAnim.value})`,
    };
  });

  const selectedMarkerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotateAnim.value}deg` }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.marker,
        !isSelected && markerStyle,
        isSelected && styles.markerSelected,
        isSelected && selectedMarkerStyle,
        {
          left: offsetX,
          top: offsetY,
        }
      ]}
    >
      <Pressable onPress={() => onSelect(node)} style={{ flex: 1 }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    position: 'absolute',

  },
  markerSelected: {
    borderWidth: 2,
    borderColor: 'red',
    borderStyle: 'dashed',
  },
});
