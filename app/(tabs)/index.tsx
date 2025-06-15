import GeminiClient from "@/features/gemini/mapAI";
import useDialog from "@/hooks/useDialog";
import {
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import React, { useCallback, useRef, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  ActivityIndicator,
  Button,
  Chip,
  Divider,
  Icon,
  IconButton,
  Searchbar,
  Text,
} from "react-native-paper";
import { useStore } from "@/context/store/StoreContext";
import Gallery from "@/components/Gallery";
import UploadOptionsSheet from "@/components/UploadOptionsSheet";
import CustomBackdrop from "@/components/ui/BottomSheet/CustomBackdrop";
import { STATIC_SHEET_SNAP_POINTS } from "@/components/ui/BottomSheet/bottomSheetConfig";
import { FlowAiResponse } from "@/features/flow/types";
import flowAI from "@/features/gemini/flowAI";
import { router } from "expo-router";
import { CardType } from "@/types/types";
import { testFlowImage } from "@/utils/testFlowImage";
import { MapAiResponse, MapDisplayerProps } from "@/features/map/types";

export default function HomeScreen() {
  const [isMapMode, setIsMapMode] = useState<boolean>(true);
  const [Dialog, showDialog] = useDialog();
  const uploadOptionsRef = useRef<BottomSheetModal>(null);
  const { saveMap, saveFlow } = useStore();
  const [input, setInput] = useState<string>("");
  const [selectedImageBase64, setSelectedImageBase64] = useState<
    string | undefined
  >(undefined);

  const [loading, setLoading] = useState<boolean>(false);
  const bottomSheetConfig = useBottomSheetSpringConfigs({
    damping: 80,
    overshootClamping: true,
    restDisplacementThreshold: 0.1,
    restSpeedThreshold: 0.1,
    stiffness: 500,
  });
  //FIXME 键盘输入完发送后键盘不会自动关闭
  const handleSend = useCallback(async () => {
    if (!input.trim() && !selectedImageBase64)
      throw new Error("输入不可以为空");

    console.log("用户发送：", input);
    console.log("发送附件：", selectedImageBase64?.slice(0, 100));
    if (isMapMode) {
      setLoading(true);
      try {
        const res = await GeminiClient.sendMessage(input, selectedImageBase64);
        const obj: MapAiResponse = JSON.parse(res.text);
        const map: MapDisplayerProps = {
          imageUri: res.image,
          title: obj.title,
          nodes: obj.nodes,
        };
        setSelectedImageBase64(undefined);
        saveMap(map, res.mimeType).then((path) => {
          router.push({
            pathname: "/mapDetail",
            params: { path },
          });
        });
        setInput("");
        setSelectedImageBase64(undefined);
      } catch (err) {
        console.error("Error in handleSend:", err);
        showDialog("ERROR", () => <Text>{String(err)}</Text>);
      } finally {
        setLoading(false);
      }
    } else {
      //  然后主页scroll能够看到生成的卡片，虽然没有实现缩略图的内容
      setLoading(true);
      try {
        await flowAI.sendMessage(input, selectedImageBase64).then((res) => {
          if (res.text) {
            const result: FlowAiResponse = JSON.parse(res.text);
            if (result) {
              //TODO: 替换图片
              saveFlow({ ...result, imageUri: testFlowImage }).then((path) => {
                if (path) {
                  router.push({
                    pathname: "/flowDetail",
                    params: { path },
                  });
                }
              }); // TODO: 在进入flow中修改后仍然是使用此处的状态，需要在组件change调用update
            } else {
              showDialog("ERROR", () => <Text>生成流程失败</Text>);
            }
          }
        });
      } catch (err) {
        console.log("Error out of try:", err);
        showDialog("ERROR", () => <Text>{String(err)}</Text>);
      } finally {
        setLoading(false);
        setInput("");
        setSelectedImageBase64(undefined);
      }
    }
  }, [input, selectedImageBase64, isMapMode, saveMap, showDialog, saveFlow]);

  const handleReviewCard = useCallback(
    (cardType: CardType, cardPath: string) => {
      router.push({
        pathname: cardType === "map" ? "/mapDetail" : "/flowDetail",
        params: {
          path: cardPath,
        },
      });
    },
    []
  );

  const handleUploadOptions = useCallback(() => {
    uploadOptionsRef.current?.present();
  }, []);

  const handleFilePress = useCallback(() => {
    uploadOptionsRef.current?.dismiss();
    // TODO: 实现文件选择功能
    console.log("打开文件选择器");
  }, []);

  const handleImageSelect = (s: string) => {
    setSelectedImageBase64(s);
    uploadOptionsRef.current?.dismiss();
  };
  const handleCancelImage = useCallback(() => {
    setSelectedImageBase64(undefined);
  }, []);

  const renderSearchbarRight = (props: any) => {
    return loading ? (
      <ActivityIndicator {...props} />
    ) : (
      <IconButton
        {...props}
        onPress={handleSend}
        icon="send"
        disabled={!input && !selectedImageBase64}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.hello}>
        <View style={styles.titleGroup}>
          <Text
            variant="titleLarge"
            style={{ fontWeight: "bold", fontStyle: "italic" }}
          >
            MindLane
          </Text>
          <Text
            variant="bodySmall"
            style={{ color: "gray", fontWeight: "bold", fontStyle: "italic" }}
          >
            今天想学点什么
          </Text>
        </View>
        <Divider bold />
      </View>
      <ScrollView style={styles.topContentContainer}>
        <View style={styles.gallery}>
          <Text
            variant="titleLarge"
            style={{ fontWeight: "bold", fontStyle: "italic" }}
          >
            Latest
          </Text>
          <ScrollView
            style={{
              maxHeight: 60,
            }}
            horizontal={true}
            contentContainerStyle={{
              maxHeight: 50,
              gap: 8,
              paddingHorizontal: 20,
              marginVertical: 8,
              alignItems: "center",
            }}
          >
            <Button mode="contained">流程</Button>
            <Button mode="contained">路线1</Button>
            <Button mode="contained">路线2</Button>
            <Button mode="contained">路线3</Button>
            <Button
              mode="contained"
              onPress={() => showDialog("DialogTItle", () => <Text>123</Text>)}
            >
              DialogContent
            </Button>
          </ScrollView>
          <Gallery onPressCard={handleReviewCard} />
        </View>
      </ScrollView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        style={styles.bottomSectionContainer}
      >
        {selectedImageBase64 && (
          <View style={styles.imagePreviewContainer}>
            <View style={styles.imageWrapper}>
              <Image
                source={{ uri: `data:image/png;base64,${selectedImageBase64}` }}
                style={styles.selectedImagePreview}
              />
              <View style={styles.closeButton}>
                <IconButton
                  icon="close-circle"
                  size={20}
                  onPress={handleCancelImage}
                  iconColor="gray"
                />
              </View>
            </View>
          </View>
        )}
        <View style={styles.searchBarContainer}>
          <Searchbar
            placeholder="请输入内容"
            mode="bar"
            elevation={2}
            onChangeText={setInput}
            submitBehavior="blurAndSubmit"
            icon="tune"
            onIconPress={handleUploadOptions}
            right={renderSearchbarRight}
            value={input}
          />
        </View>
        <View style={styles.chipContainer}>
          <Chip
            style={styles.searchChip}
            selected={isMapMode}
            onPress={() => setIsMapMode(true)}
            avatar={<Icon source="map-marker-path" size={20} />}
          >
            Map
          </Chip>
          <Chip
            style={styles.searchChip}
            selected={!isMapMode}
            onPress={() => setIsMapMode(false)}
            avatar={<Icon source="backburger" size={20} />}
          >
            Flow
          </Chip>
        </View>
      </KeyboardAvoidingView>
      {Dialog}
      <BottomSheetModal
        ref={uploadOptionsRef}
        snapPoints={STATIC_SHEET_SNAP_POINTS}
        backdropComponent={CustomBackdrop}
        enableDynamicSizing={false}
        animationConfigs={bottomSheetConfig}
      >
        <BottomSheetView style={styles.uploadSheetView}>
          <UploadOptionsSheet
            onImageSelect={handleImageSelect}
            onFileSelect={handleFilePress}
          />
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  hello: {
    marginBottom: 5,
    paddingBottom: 5,
    gap: 10,
    height: 70,
  },
  container: {
    flex: 1,
    paddingHorizontal: 5,
    paddingTop: 10,
  },
  titleGroup: {
    flexDirection: "column",
    flex: 1,
  },
  searchContainer: {
    flexDirection: "column",
    marginBottom: 10,
    marginHorizontal: 10,
    padding: 5,
    gap: 10,
  },
  searchChip: {
    borderRadius: 20,
  },
  chipContainer: {
    flexDirection: "row",
    gap: 10,
  },
  chipAndImageContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectedImagePreview: {
    width: 50,
    height: 50,
    borderRadius: 5,
  },
  gallery: {
    flexDirection: "column",
    alignItems: "flex-start",
    justifyContent: "flex-start",
    width: "100%",
  },
  uploadSheetView: {
    flex: 1,
    padding: 16,
  },
  topContentContainer: {
    flex: 1,
  },
  bottomSection: {
    padding: 10,
    alignItems: "flex-start",
    borderWidth: 2,
    borderColor: "gray",
    borderRadius: 10,
  },
  bottomSectionContainer: {
    padding: 10,
    alignItems: "flex-start",
    marginVertical: 10,
  },
  imagePreviewContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
  },
  imageWrapper: {
    position: "relative",
  },
  closeButton: {
    position: "absolute",
    top: -20,
    right: -20,
    zIndex: 1,
  },
  cancelButton: {
    marginLeft: 10,
    padding: 5,
  },
  searchBarContainer: {
    marginBottom: 10,
    alignSelf: "stretch",
  },
});
