import { Text, TextInput, IconButton, List, Button } from "react-native-paper";
import { StyleSheet, View } from "react-native";
import React, { useCallback, useRef, useState } from "react";
import {
  BottomSheetModal,
  BottomSheetView,
  useBottomSheetSpringConfigs,
} from "@gorhom/bottom-sheet";
import { DEFAULT_GROUP, useStore } from "@/context/store/StoreContext";
import { FlatList } from "react-native-gesture-handler";
import useDialog from "@/hooks/useDialog";
import { Card } from "@/types/types";
import { router } from "expo-router";
import CustomBackdrop from "@/components/ui/BottomSheet/CustomBackdrop";
function DialogTextInput({
  onChangeText,
  label,
}: {
  onChangeText: (text: string) => void;
  label: string;
}) {
  const [inputValue, setInputValue] = useState<string>("");
  return (
    <TextInput
      label={label}
      value={inputValue}
      submitBehavior="blurAndSubmit"
      onChangeText={(text) => {
        setInputValue(text);
        onChangeText(text);
      }}
    />
  );
}
export default function StorageScreenn() {
  const [Dialog, showDialog] = useDialog();
  const newGroupName = useRef("");

  const replaceGroupname = useRef<string>(null);
  const currentGroupRef = useRef<string>(null);
  const currentCardRef = useRef<{ group: string; card: Card }>(null);

  const { data, addGroup, removeGroup, renameGroup, removeCard, moveCard } =
    useStore();
  const groupList = Object.keys(data).filter(
    (group) => group !== DEFAULT_GROUP
  );
  const listData = Object.entries(data).filter(
    (group) => group[0] !== DEFAULT_GROUP
  );
  const bottomSheetConfig = useBottomSheetSpringConfigs({
    damping: 80,
    overshootClamping: true,
    restDisplacementThreshold: 0.1,
    restSpeedThreshold: 0.1,
    stiffness: 500,
  });

  const bottomGroupDetailModalRef = useRef<BottomSheetModal>(null);
  const bootomCardDetailModalRef = useRef<BottomSheetModal>(null);
  const bottomMoveCardModalRef = useRef<BottomSheetModal>(null);

  const handleAddGroup = useCallback(() => {
    showDialog(
      "Add Group",
      () => (
        <DialogTextInput
          label="Add Group Name"
          onChangeText={(text) => (newGroupName.current = text)}
        />
      ),
      [
        { label: "Close" },
        {
          label: "Confirm",
          onPress: () => {
            addGroup(newGroupName.current.trim());
          },
        },
      ]
    );
  }, [addGroup, showDialog]);

  const handleRenameGroup = useCallback(() => {
    bottomGroupDetailModalRef.current?.dismiss();
    showDialog(
      "Rename Group",
      () => (
        <DialogTextInput
          label="New Group Name"
          onChangeText={(text) => (replaceGroupname.current = text)}
        />
      ),
      [
        { label: "Close" },
        {
          label: "Confirm",
          onPress: () => {
            if (currentGroupRef.current && replaceGroupname.current)
              renameGroup(currentGroupRef.current, replaceGroupname.current);
          },
        },
      ]
    );
  }, [renameGroup, showDialog]);

  const handleDeleteGroup = useCallback(() => {
    bottomGroupDetailModalRef.current?.dismiss();
    showDialog(
      `确定删除 ${currentGroupRef.current} ?`,
      () => <Text>该操作不可逆</Text>,
      [
        { label: "Close" },
        {
          label: "Confirm",
          onPress: () => {
            if (!currentGroupRef.current) return;
            removeGroup(currentGroupRef.current);
          },
        },
      ]
    );
  }, [removeGroup, showDialog]);

  const handleRemoveCard = useCallback(() => {
    if (!currentCardRef.current) return;
    removeCard(currentCardRef.current.group, currentCardRef.current.card);
    bootomCardDetailModalRef.current?.dismiss();
  }, [removeCard]);

  const handleMoveCard = useCallback(
    (targetGroup: string) => {
      if (!currentCardRef.current) return;
      bootomCardDetailModalRef.current?.dismiss();
      moveCard(
        currentCardRef.current.card,
        targetGroup,
        currentCardRef.current.group
      );
      bottomMoveCardModalRef.current?.dismiss();
    },
    [moveCard]
  );

  const handleReviewCard = useCallback((card: Card) => {
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

  const handleShowGroupBottomSheet = useCallback((group: string) => {
    currentGroupRef.current = group;
    bottomGroupDetailModalRef.current?.present();
  }, []);
  const handleShowCardBottomSheet = useCallback((group: string, card: Card) => {
    currentCardRef.current = { card, group };
    bootomCardDetailModalRef.current?.present();
  }, []);
  const handleShowMoveBottomSheet = useCallback(() => {
    bottomMoveCardModalRef.current?.dismiss();
    bottomMoveCardModalRef.current?.present();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerContainer}>
        <Text variant="titleLarge">Storage</Text>
        <IconButton
          icon="plus"
          style={{ margin: 0 }}
          onPress={handleAddGroup}
        />
      </View>
      <FlatList
        data={listData}
        showsVerticalScrollIndicator={false}
        renderItem={({ item: groupEntry }) => (
          <List.Accordion
            title={groupEntry[0]}
            left={(props) => (
              <List.Icon {...props} style={{ marginRight: 0 }} icon="folder" />
            )}
            style={{ paddingRight: 0 }}
            onLongPress={() => handleShowGroupBottomSheet(groupEntry[0])}
          >
            {groupEntry[1].map((card) => (
              <List.Item
                key={card.createAt}
                title={card.title}
                style={{ paddingRight: 0 }}
                left={(props) => (
                  <List.Icon
                    {...props}
                    style={{ marginRight: 0 }}
                    icon={card.type === "map" ? "map" : "map-marker-path"}
                  />
                )}
                onPress={() => handleReviewCard(card)}
                right={(props) => (
                  <IconButton
                    {...props}
                    icon="dots-vertical"
                    onPress={() =>
                      handleShowCardBottomSheet(groupEntry[0], card)
                    }
                  />
                )}
              />
            ))}
          </List.Accordion>
        )}
      />
      <BottomSheetModal
        style={styles.bottomSheetContainer}
        ref={bottomGroupDetailModalRef}
        backdropComponent={CustomBackdrop}
        enableDynamicSizing={false}
        snapPoints={["25%"]}
        animationConfigs={bottomSheetConfig}
      >
        <BottomSheetView style={{ gap: 8 }}>
          <Button icon="rename-box" mode="outlined" onPress={handleRenameGroup}>
            Rename
          </Button>
          <Button icon="delete" mode="outlined" onPress={handleDeleteGroup}>
            Delete
          </Button>
        </BottomSheetView>
      </BottomSheetModal>

      <BottomSheetModal
        style={styles.bottomSheetContainer}
        ref={bootomCardDetailModalRef}
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
        ref={bottomMoveCardModalRef}
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
      {Dialog}
    </View>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  headerContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scrollViewContainer: { flex: 1, width: "100%" },

  content: {
    backgroundColor: "#f0f0f0",
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  item: { paddingVertical: 2, paddingLeft: 8 },
  bottomSheetContainer: {
    padding: 16,
  },
});
