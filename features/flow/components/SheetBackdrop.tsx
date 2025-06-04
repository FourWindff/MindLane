import { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useMemo } from "react";
import Animated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";
import FlowCanvas from "./FlowCanvas";
import { Button, IconButton } from "react-native-paper";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, View } from "react-native";

interface SheetBackdropProps extends BottomSheetBackdropProps {
  onBack?: () => void;
}

export default function SheetBackdrop({ animatedIndex, style, onBack }: SheetBackdropProps) {
  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedIndex.value,
      [0, 1],
      [0, 1],
      Extrapolation.CLAMP
    )
  }));

  const containerStyle = useMemo(() => [
    style,
    containerAnimatedStyle,
  ],
    [style, containerAnimatedStyle]
  );

  return (
    <Animated.View style={containerStyle}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <IconButton
            onPress={onBack}
            icon='chevron-left-circle-outline'
            style={styles.backButton}
          />
          <FlowCanvas />
        </View>
      </SafeAreaView>
    </Animated.View>
  )
} 

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    borderColor:'red',
    borderWidth:5,
  },
  backButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'white',
    zIndex: 10,
    margin:20,
  }
});