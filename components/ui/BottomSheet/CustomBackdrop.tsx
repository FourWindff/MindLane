import React, { useMemo } from "react";
import { BottomSheetBackdropProps, SCREEN_HEIGHT, useBottomSheet } from "@gorhom/bottom-sheet";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

const CustomBackdrop = ({ animatedPosition, style }: BottomSheetBackdropProps) => {
  const { close } = useBottomSheet();

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      animatedPosition.value,
      [0, SCREEN_HEIGHT],
      [1, 0],
      Extrapolation.CLAMP
    ),
  }));


  const containerStyle = useMemo(
    () => [
      style,
      {
        backgroundColor: "black",
      },
      containerAnimatedStyle,
    ],
    [style, containerAnimatedStyle]
  );

  const tapHandler = useMemo(() => {
    const gesture = Gesture.Tap().onEnd(() => {
      runOnJS(close)();
    });
    return gesture;
  }, [close]);


  return (
    <GestureDetector gesture={tapHandler}>
      <Animated.View style={containerStyle} />
    </GestureDetector>
  );
};

export default CustomBackdrop;