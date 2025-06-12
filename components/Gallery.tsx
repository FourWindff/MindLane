import { FlatList, StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { DEFAULT_GROUP, useStore } from "@/context/store/StoreContext";
import { Card, CardType } from "@/types/types";
import MindCard from "@/components/MindCard";

interface GalleryProps {
  onPressCard: (cardType: CardType, cardPath: string) => void;
}

export default function Gallery({ onPressCard }: GalleryProps) {
  const { data } = useStore();
  const historyData: Card[] = data?.[DEFAULT_GROUP] || [];
  const historyDataSoeted = [...historyData].sort(
    (a, b) => b.createAt - a.createAt
  );

  if (historyDataSoeted.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon source="file-document-outline" size={48} color="#666" />
        <Text variant="titleLarge" style={styles.emptyText}>
          No History Data
        </Text>
        <Text variant="bodyMedium" style={styles.emptySubtext}>
          Your history will appear here
        </Text>
      </View>
    );
  }

  //TODO 使用虚拟列表渲染，避免长度过长渲染了看不见的。
  return (
    <FlatList
      horizontal={true}
      data={historyDataSoeted}
      renderItem={({ item: card }) => (
        <MindCard
          key={card.filepath}
          path={card.filepath}
          onPress={onPressCard}
          type={card.type}
        />
      )}
      keyExtractor={(item) => item.filepath}
      ItemSeparatorComponent={() => <View style={{ width: 12 }} />}
      contentContainerStyle={styles.scrollContent}
    />
  );
}

const styles = StyleSheet.create({
  scrollView: {},
  scrollContent: {
    marginLeft: 20,
    alignItems: "center",
    padding: 20,
  },
  emptyContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    width: 200,
    height: 200,
    alignSelf: "center",
  },
  emptyIcon: {
    opacity: 0.6,
    marginBottom: 16,
  },
  emptyText: {
    color: "#666",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtext: {
    color: "#999",
    textAlign: "center",
    maxWidth: 300,
  },
  surface: {
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  image: {
    height: 300,
    width: 300,
  },
});
