import GeminiClient from "@/features/gemini/mapAI";
import MapDisplayer, { MapAiResponse, MapDisplayerProps } from "@/features/map";
import useDialog from "@/hooks/useDialog";
import {
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
import { loadJsonDataSync } from "@/utils/filesystem/file";
import UploadOptionsSheet from "@/components/UploadOptionsSheet";
import CustomBackdrop from "@/components/ui/BottomSheet/CustomBackdrop";
import { STATIC_SHEET_SNAP_POINTS } from "@/components/ui/BottomSheet/bottomSheetConfig";

const HomeRoute = () => {
  const [isMapMode, setIsMapMode] = useState<boolean>(true);
  const [Dialog, showDialog] = useDialog();
  const bottomMapModalRef = useRef<BottomSheetModal>(null);
  const uploadOptionsRef = useRef<BottomSheetModal>(null);
  const { saveMap } = useStore();
  const [map, setMap] = useState<MapDisplayerProps | undefined>(undefined);
  const [input, setInput] = useState("模拟请求");
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

  const handleSend = useCallback(async () => {
    if (isMapMode) {
      bottomMapModalRef.current?.present();
      setLoading(true);
      try {
        const res = await GeminiClient.sendMessage(input, selectedImageBase64);
        const obj: MapAiResponse = JSON.parse(res.text);
        const base64Data = res.image;
        const map: MapDisplayerProps = {
          imageUri: `data:image/png;base64,${base64Data}`,
          title: obj.title,
          nodes: obj.nodes,
        };
        setMap(map);
        setSelectedImageBase64(undefined);
        await saveMap({ ...map, imageUri: res.image }, res.mimeType);
      } catch (err) {
        console.error("Error in handleSend:", err);
        showDialog("ERROR", () => <Text>{String(err)}</Text>);
      } finally {
        setLoading(false);
      }
    } else {
      console.log("生成可视化流程", input);
    }
  }, [input, isMapMode, saveMap, selectedImageBase64, showDialog]);

  const handleReviewCard = (cardPath: string) => {
    const data = loadJsonDataSync(cardPath, {} as MapDisplayerProps);
    setMap(data);
    bottomMapModalRef.current?.present();
  };
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

  //TODO 如果backdrop出现的index似乎只能大于1。如果让它在0出现，背景不会出现
  const snapPoints = useMemo(() => ["65", "70"], []);

  const BottomMapModal = () => {
    return (
      <View
        style={{
          width: "100%",
          height: "100%",
        }}
      >
        <MapDisplayer
          title={map?.title}
          nodes={map?.nodes}
          imageUri={map?.imageUri}
        />
      </View>
    );
  };

  const handleSheetChanges = useCallback((index: number) => {
    if (index === -1) {
      setMap(undefined);
    }
    console.log("handleSheetChanges", index);
  }, []);

  const renderSearchbarRight = (props: any) => {
    return loading ? (
      <ActivityIndicator {...props} />
    ) : (
      <IconButton {...props} onPress={handleSend} icon="send" />
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
            value={input}
            mode="bar"
            elevation={2}
            onChangeText={setInput}
            submitBehavior="blurAndSubmit"
            icon="plus"
            onIconPress={handleUploadOptions}
            right={renderSearchbarRight}
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
        backdropComponent={CustomBackdrop}
        ref={bottomMapModalRef}
        snapPoints={snapPoints}
        index={1}
        onChange={handleSheetChanges}
        enableDynamicSizing={true}
        animationConfigs={bottomSheetConfig}
      >
        <BottomSheetView>
          <BottomMapModal />
        </BottomSheetView>
      </BottomSheetModal>

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
};

const styles = StyleSheet.create({
  hello: {
    width: "100%",
    marginBottom: 5,
    paddingBottom: 5,
    flexDirection: "column",
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

export default HomeRoute;
