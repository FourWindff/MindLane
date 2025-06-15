import { Button, Text, List, IconButton } from "react-native-paper";
import { StyleSheet, View } from "react-native";
import React, { useCallback, useRef } from "react";
import { DEFAULT_GROUP, useStore } from "@/context/store/StoreContext";
import { Card } from "@/types/types";
import {
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import CustomBackdrop from "@/components/ui/BottomSheet/CustomBackdrop";
import { FlatList } from "react-native-gesture-handler";
import { router } from "expo-router";

export default function HistoryScreen() {
  const currentCard = useRef<Card | null>(null);
  const { data, removeCard, moveCard } = useStore();
  const historyData: Card[] = data?.[DEFAULT_GROUP] || [];
  const groupList = Object.keys(data).filter(
    (group) => group !== DEFAULT_GROUP
  );

  const bottomDetailModalRef = useRef<BottomSheetModal>(null);
  const bottomGroupModalRef = useRef<BottomSheetModal>(null);
  const bottomSheetConfig = useBottomSheetSpringConfigs({
    damping: 80,
    overshootClamping: true,
    restDisplacementThreshold: 0.1,
    restSpeedThreshold: 0.1,
    stiffness: 500,
  });
  function getDateLabel(timestamp: number) {
    const date = new Date(timestamp);
    const now = new Date();
    const mins =
      date.getMinutes() < 10 ? "0" + date.getMinutes() : "" + date.getMinutes();
    const hours =
      date.getHours() < 10 ? "0" + date.getHours() : "" + date.getHours();
    const day =
      date.getDate() < 10 ? "0" + date.getDate() : "" + date.getDate();
    const month =
      date.getMonth() + 1 < 10
        ? "0" + (date.getMonth() + 1)
        : "" + (date.getMonth() + 1);
    // 今天
    if (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    ) {
      return "今天 " + hours + ":" + mins;
    }

    // 昨天
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (
      date.getFullYear() === yesterday.getFullYear() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getDate() === yesterday.getDate()
    ) {
      return "昨天 " + hours + ":" + mins;
    }

    // 其他日期
    return month + "." + day + " " + date.getHours() + ":" + mins;
  }

  const handleShowDetailBottomSheet = useCallback((card: Card) => {
    currentCard.current = card;
    bottomDetailModalRef.current?.present();
  }, []);
  const handleShowMoveBottomSheet = useCallback(() => {
    bottomDetailModalRef.current?.dismiss();
    bottomGroupModalRef.current?.present();
  }, []);
  const handleReview = useCallback((card: Card) => {
    if (card.type === "flow") {
      router.push({
        pathname: "/flowDetail",
        params: { path: card.filepath },
      });
    } else if (card.type === "map") {
      router.push({
        pathname: "/mapDetail",
        params: { path: card.filepath },
      });
    }
  }, []);

  const handleRemoveCard = useCallback(() => {
    if (!currentCard.current) return;
    removeCard(DEFAULT_GROUP, currentCard.current);
    bottomDetailModalRef.current?.dismiss();
  }, [removeCard]);

  const handleMoveCard = useCallback(
    (targetGroup: string) => {
      if (!currentCard.current) return;
      moveCard(currentCard.current, targetGroup);
      bottomGroupModalRef.current?.dismiss();
    },
    [moveCard]
  );

  return (
    <View style={styles.container}>
      <Text variant="titleLarge">History</Text>
      <FlatList
        data={historyData}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: card }) => {
          return (
            <List.Item
              title={card.title}
              description={getDateLabel(card.createAt)}
              style={{ paddingRight: 0 }}
              left={(props) => (
                <List.Icon
                  {...props}
                  style={{ marginRight: 0 }}
                  icon={card.type === "map" ? "map" : "map-marker-path"}
                />
              )}
              onPress={() => handleReview(card)}
              right={(props) => (
                <IconButton
                  {...props}
                  icon="dots-vertical"
                  onPress={() => handleShowDetailBottomSheet(card)}
                />
              )}
            />
          );
        }}
      />

      <BottomSheetModal
        style={styles.bottomSheetContainer}
        ref={bottomDetailModalRef}
        backdropComponent={CustomBackdrop}
        enableDynamicSizing={false}
        snapPoints={["25%"]}
        animationConfigs={bottomSheetConfig}
      >
        <BottomSheetView style={{ gap: 8 }}>
          <Button
            icon="folder-move"
            mode="outlined"
            onPress={handleShowMoveBottomSheet}
          >
            Move
          </Button>
          <Button icon="delete" mode="outlined" onPress={handleRemoveCard}>
            Delete
          </Button>
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        style={styles.bottomSheetContainer}
        ref={bottomGroupModalRef}
        backdropComponent={CustomBackdrop}
        animationConfigs={bottomSheetConfig}
        handleComponent={null}
      >
        <BottomSheetView style={{ paddingBottom: 20 }}>
          <Text style={{ alignSelf: "center" }} variant="bodyLarge">
            将页面移至
          </Text>
          <FlatList
            data={groupList}
            renderItem={({ item: group }) => (
              <List.Item
                title={group}
                left={(props) => <List.Icon {...props} icon="folder" />}
                style={{
                  borderBottomColor: "rgba(0,0,0,0.1)",
                  borderBottomWidth: 2,
                }}
                onPress={() => handleMoveCard(group)}
              />
            )}
          />
        </BottomSheetView>
      </BottomSheetModal>
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },

  shaixuanbutton: {
    borderRadius: 4,
    height: 40,
    paddingHorizontal: 5,
    marginVertical: 0,
    marginHorizontal: 5,
    alignItems: "center",
  },
  buttonContent: {
    justifyContent: "center",
    alignItems: "center",
  },
  chip: {
    margin: 5,
  },
  bottomSheetContainer: {
    padding: 16,
  },
  categoryChip: {
    margin: 4,
  },
});
