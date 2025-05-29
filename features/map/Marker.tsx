import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, interpolate } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Node } from "./index";

interface MarkerProps {
  isSelected: boolean;
  offsetX: number;
  offsetY: number;
  onSelect: (node: Node) => void;
  node: Node;
}

export default function Marker({ isSelected, offsetX, offsetY, onSelect, node }: MarkerProps) {
  const pulseAnim = useSharedValue(0);
  const rotateAnim = useSharedValue(0);
  const blurIntensity = useSharedValue(0);

  useEffect(() => {
    // Reset animations when selection state changes
    pulseAnim.value = 0;
    blurIntensity.value = 0;
    rotateAnim.value = 0;
    
    if (!isSelected) {
      // Breathing effect for unselected markers
      pulseAnim.value = withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
      // Blur intensity animation for unselected markers
      blurIntensity.value = withRepeat(
        withTiming(10, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      // Rotation animation for selected marker
      rotateAnim.value = withRepeat(
        withTiming(360, { duration: 4000, easing: Easing.linear }),
        -1
      );
    }
  }, [pulseAnim, rotateAnim, blurIntensity, isSelected]);

  const markerStyle = useAnimatedStyle(() => {
    if (isSelected) return {};
    
    const scale = interpolate(pulseAnim.value, [0, 1], [0.8, 1.2]);
    const opacity = interpolate(pulseAnim.value, [0, 1], [0.6, 1]);
    const blur = interpolate(blurIntensity.value, [0, 10], [0, 5]);
    
    return {
      transform: [{ scale }],
      opacity,
      // We'll use these values in the render method
      blurAmount: blur,
    };
  });

  const selectedMarkerStyle = useAnimatedStyle(() => {
    return {
      transform: [{ rotate: `${rotateAnim.value}deg` }],
    };
  });


  const renderMarkerContent = () => {
    if (isSelected) {
      return (
        <Animated.View style={[styles.selectedMarkerContainer, selectedMarkerStyle]}>
          <Animated.View style={[styles.dashedBorder]}>
            <View style={[styles.marker, styles.markerSelected]}>
              <View style={styles.selectedInnerMarker} />
            </View>
          </Animated.View>
        </Animated.View>
      );
    }
    
    return (
      <Animated.View style={[styles.marker, markerStyle]}>
        <BlurView 
          intensity={markerStyle.blurAmount || 0}
          style={styles.blurView}
          tint="light"
        >
          <View style={styles.innerMarker} />
        </BlurView>
      </Animated.View>
    );
  };

  return (
    <Pressable 
      onPress={() => onSelect(node)} 
      style={[styles.container, { 
        left: offsetX, 
        top: offsetY,
      }]}
    >
      {renderMarkerContent()}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    transform: [{ translateX: -5 }, { translateY: -5 }], // 向左上方偏移标记点大小的一半（10/2=5）
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  blurView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  innerMarker: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'white',
  },
  selectedMarkerContainer: {
    position: 'relative',
  },
  dashedBorder: {
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: '#4A90E2',
    borderRadius: '50%',
  },
  markerSelected: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(74, 144, 226, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedInnerMarker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4A90E2',
  },
});
