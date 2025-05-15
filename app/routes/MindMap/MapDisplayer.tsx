import { Image, useImage } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type Node = {
  x: number;
  y: number;
  data: {
    label: string;
    content: string;
    lane: string;
  }
};
export type MindMapAiResponse = {
  title: string;
  node: Node[]
}
export type MapDisplayerProps = MindMapAiResponse & {
  imageUri: string;
}


export default function MapDisplayer({ imageUri, title, node }: MapDisplayerProps) {
  //TODO node[0] >0
  const [selectedNode, setSelectedNode] = useState<Node>(node[0]);
  const [layout, setLayout] = useState<{ width: number, height: number }>({ width: 0, height: 0 });
  const image = useImage({ uri: imageUri }, {
    onError: (e) => {
      console.log(e.message);
    }
  });

  // 计算图片缩放比例
  const getScaleFactor = () => {
    if (!image?.width || !layout.width) return { scaleX: 1, scaleY: 1 };

    // 计算宽高比
    const imageRatio = image.width / image.height;
    const containerRatio = layout.width / layout.height;

    let scaleX, scaleY;

    if (imageRatio > containerRatio) {
      // 图片比容器更宽，以宽度为基准
      scaleX = layout.width / image.width;
      scaleY = scaleX;  // 保持宽高比
    } else {
      // 图片比容器更高，以高度为基准
      scaleY = layout.height / image.height;
      scaleX = scaleY;  // 保持宽高比
    }

    return { scaleX, scaleY };
  };

  // 获取缩放比例
  const { scaleX, scaleY } = getScaleFactor();

  console.log("图片真实宽高", image?.width, image?.height);

  return (
    <View style={styles.container}>
      <View style={styles.imageContainer}>
        <Image
          style={styles.image}
          source={image}
          contentFit="cover"
          transition={1000}
          onLayout={(e) => setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        />
        {node.map((item, index) => (
          <Pressable
            key={index}
            style={[styles.marker, { left: item.x * scaleX, top: item.y * scaleY }, selectedNode === item && styles.markerSelected]}
            onPress={() => setSelectedNode(item)}
          >
          </Pressable>
        ))}
      </View>

      <View style={styles.progressContainer}>
        {node.map((item, index) => (
          <View key={index} >
            <Pressable
              style={[
                styles.progressCircle,
                selectedNode === item && styles.progressCircleSelected]}
              onPress={() => setSelectedNode(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.progressText} >{index + 1}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {selectedNode && (
        <View style={styles.contentContainer}>
          <Text style={styles.contentLabel}>{selectedNode.data.label}</Text>
          <Text style={styles.content}>{selectedNode.data.content}</Text>
          <Text style={styles.contentLane}>{selectedNode.data.lane}</Text>
        </View>
      )}
    </View>
  )

}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  imageContainer: {
    marginTop: 20,
    width: '100%',
    maxWidth: 300,
    maxHeight: 300,
    flex: 1,
    marginHorizontal: 20,
    alignSelf: 'center',
    position: 'relative',
    marginBottom: 20,
    borderColor: 'red'
  },
  image: {
    width: '100%',
    height: '100%',
  },
  marker: {
    width: 20,
    height: 20,
    borderRadius: 10,
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    padding: 5,
    transform: [{ translateX: -10 }, { translateY: -10 }],
  },
  markerSelected: {
    backgroundColor: 'royalblue',
  },
  markerText: {
    color: 'white',
    fontSize: 12,
  },
  contentContainer: {
    marginTop: 10,
    padding: 10,
    marginHorizontal: 20,
    gap: 5,
  },
  contentLabel: {
    fontWeight: '700',
    fontSize: 20,
    marginBottom: 5,
  },
  content: {
    fontSize: 15,
  },
  contentLane: {
    fontSize: 15,
  },

  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    marginBottom: 10,
    gap: 10,
  },
  progressCircle: {
    display: 'flex',
    width: 30,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  progressCircleSelected: {
    backgroundColor: 'royalblue',
  },
  progressText: {
    fontSize: 13,
    padding: 0,
    margin: 0,
    textAlign: 'center',
    lineHeight: 16
  },
});
