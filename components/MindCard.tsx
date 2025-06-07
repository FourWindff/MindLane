import {Button, Card as PPCard, Surface, Text, useTheme} from "react-native-paper";
import {StyleSheet} from "react-native";
import useDataLoader from "@/hooks/useDataLoader";
import {MapDisplayerProps} from "@/features/map";
import {FlowDisplayerProps} from "@/features/flow/types";
import {testFlowImage} from "@/app/navigation/testFlowImage";

interface CardProps {
  cardPath: string;
  onPress: (cardPath: string) => void;
}

// TODO: 为卡片增加Flow的显示内容，未测试
type GalleryProps = MapDisplayerProps | FlowDisplayerProps;
type CardType = MapDisplayerProps | (FlowDisplayerProps & {imageUri: string});
const newGallery = {} as GalleryProps;

export default function MindCard({ cardPath, onPress}: CardProps) {
  const [card] = useDataLoader(cardPath, newGallery);
  // 区分 MapDisplayerProps 和 FlowDisplayerProps以分别显示封面
  let cardData : CardType;
  if ('imageUri' in card) { // MapDisplayerProps type
    cardData = card as MapDisplayerProps;
  } else { // FlowDisplayerProps
    cardData = card as FlowDisplayerProps & {imageUri : string};
    cardData.imageUri = testFlowImage;
  }

  const theme = useTheme();
  return (
    <PPCard>
      <Surface style={styles.surface} elevation={4}>
        <PPCard.Cover
          source={{uri: cardData.imageUri}}
          style={styles.image}
          resizeMode="cover"
        />
        <PPCard.Actions style={styles.cardActions}>
          <Text
            variant="titleLarge"
            ellipsizeMode="tail"
            numberOfLines={1}
            style={{color: theme.colors.onBackground, fontWeight: 'bold'}}
          >
            {cardData.title}
          </Text>
          <Button onPress={()=> onPress(cardPath)} mode={"contained-tonal"}>Review</Button>
        </PPCard.Actions>
      </Surface>
    </PPCard>
  )
}

const styles = StyleSheet.create({
  surface: {
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    height: 300,
    width: 300,
  },
  cardActions: {
    position: 'absolute',
    left: 20,
    bottom: 20,
    right: 20,
    gap: 10,
    flexDirection: 'column',
    alignItems: 'flex-start',
  },

})