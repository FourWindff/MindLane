import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { Text, IconButton } from "react-native-paper";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import { SCREEN_HEIGHT, useBottomSheet } from "@gorhom/bottom-sheet";
import { SHEET_END_HEIGHT } from "./ui/BottomSheet/bottomSheetConfig";
import useDialog from "@/hooks/useDialog";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";

interface UploadOptionsSheetProps {
  onImageSelect: (base64String: string) => void;
  onFileSelect: () => void;
}

const UploadOptionsSheet: React.FC<UploadOptionsSheetProps> = ({
  onImageSelect,
  onFileSelect,
}) => {
  const { animatedPosition } = useBottomSheet();
  const [Dialog, showDialog] = useDialog();

  const cameraButtonStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          animatedPosition.value,
          [SCREEN_HEIGHT, SHEET_END_HEIGHT],
          [-300, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const galleryButtonStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          animatedPosition.value,
          [SCREEN_HEIGHT, SHEET_END_HEIGHT],
          [-200, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const fileButtonStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          animatedPosition.value,
          [SCREEN_HEIGHT, SHEET_END_HEIGHT],
          [-100, 0],
          Extrapolation.CLAMP
        ),
      },
    ],
  }));

  const handleCameraPress = useCallback(async () => {
    const permissionResult = await ImagePicker.requestCameraPermissionsAsync();

    if (permissionResult.granted === false) {
      showDialog("权限错误", () => <Text>需要相机权限才能拍照。</Text>);
      return;
    }

    const pickerResult = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!pickerResult.canceled) {
      const uri = pickerResult.assets[0].uri;
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        onImageSelect(base64);
        console.log("相机拍照并获取 Base64 字符串成功");
      } catch (error) {
        console.error("读取图片文件失败:", error);
        showDialog("错误", () => <Text>处理图片时出错。</Text>);
      }
    } else {
      console.log("相机拍照已取消");
    }
  }, [onImageSelect, showDialog]);

  const handleGalleryPress = useCallback(async () => {
    // uploadOptionsRef.current?.dismiss();
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permissionResult.granted === false) {
      showDialog("权限错误", () => <Text>需要图库权限才能选择图片。</Text>);
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
      mediaTypes: "images",
    });

    if (!pickerResult.canceled) {
      const uri = pickerResult.assets[0].uri;
      try {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        onImageSelect(base64);
        console.log("从图库选择图片并获取 Base64 字符串成功");
      } catch (error) {
        console.error("读取图片文件失败:", error);
        showDialog("错误", () => <Text>处理图片时出错。</Text>);
      }
    } else {
      console.log("图库选择已取消");
    }
  }, [onImageSelect, showDialog]);

  return (
    <View>
      <Text variant="bodyLarge" style={styles.title}>
        选择附件上传方式
      </Text>
      <View style={styles.actionsContainer}>
        <Animated.View style={[cameraButtonStyle, styles.buttonContaienr]}>
          <IconButton
            mode="contained"
            onPress={handleCameraPress}
            style={styles.button}
            size={40}
            icon={"camera"}
          />
          <Text style={styles.buttonText}>相机</Text>
        </Animated.View>
        <Animated.View style={[galleryButtonStyle, styles.buttonContaienr]}>
          <IconButton
            mode="contained"
            onPress={handleGalleryPress}
            style={styles.button}
            size={40}
            icon="image"
          />
          <Text style={styles.buttonText}>图库</Text>
        </Animated.View>
        <Animated.View style={[fileButtonStyle, styles.buttonContaienr]}>
          <IconButton
            mode="contained"
            onPress={onFileSelect}
            style={styles.button}
            size={40}
            icon="file"
          />
          <Text style={styles.buttonText}>文件</Text>
        </Animated.View>
      </View>
      {Dialog}
    </View>
  );
};

const styles = StyleSheet.create({
  title: {
    textAlign: "center",
    marginBottom: 20,
  },
  actionsContainer: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonContaienr: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  button: {
    marginVertical: 4,
    width: 80,
    height: 80,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 0,
  },
  iconTextContainer: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    marginTop: 4,
    fontSize: 12,
  },
});

export default UploadOptionsSheet;
