import { ScrollView, StyleSheet, View } from "react-native";
import { Icon, Text } from "react-native-paper";
import { DEFAULT_GROUP, useStore } from "@/context/store/StoreContext";
import { Card } from "@/types/types";
import MindCard from "@/components/MindCard";

interface GalleryProps {
  onPressCard: (cardPath: string) => void;
}

export default function Gallery({ onPressCard }: GalleryProps) {
  const { data } = useStore();
  const historyData: Card[] = data?.[DEFAULT_GROUP] || [];
  const historyDataSoeted = [...historyData].sort(
    (a, b) =>  b.createAt-a.createAt
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

  return (
    <ScrollView
      horizontal={true}
      style={styles.scrollView}
      contentContainerStyle={styles.scrollContent}
    >
      {historyDataSoeted.map((card, index) => (
        <MindCard key={index} cardPath={card.filepath} onPress={onPressCard} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {},
  scrollContent: {
    marginLeft: 20,
    alignItems: "center",
    gap: 12,
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
