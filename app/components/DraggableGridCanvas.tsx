import { ReactNode, useRef, useState } from "react";
import { Animated, Dimensions, PanResponder, StyleSheet, Text, View } from "react-native";

const GRID_SIZE = 20; // 网格大小
const { width, height } = Dimensions.get('window');
const EXTRA_SPACE = 2000; // 额外空间，确保画布可以延伸

interface CanvasItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  component: ReactNode;
}

// 示例自定义组件
const CustomComponent = ({ title, description }: { title: string; description: string }) => (
  <View style={styles.customComponent}>
    <View style={styles.customComponentHeader}>
      <Text style={styles.customComponentTitle}>{title}</Text>
    </View>
    <Text style={styles.customComponentContent}>{description}</Text>
  </View>
);

export default function DraggableGridCanvas() {
  // 初始化画布位置在中心
  const pan = useRef(new Animated.ValueXY({
    x: -EXTRA_SPACE,
    y: -EXTRA_SPACE
  })).current;
  
  const [scale, setScale] = useState(1);
  const [items, setItems] = useState<CanvasItem[]>([
    { 
      id: '1', 
      x: width / 2 - 100, // 屏幕中心偏左
      y: height / 2 - 75, // 屏幕中心偏上
      width: 200, 
      height: 150, 
      component: <CustomComponent title="任务1" description="这是一个示例任务描述" />
    },
    { 
      id: '2', 
      x: width / 2 + 100, // 屏幕中心偏右
      y: height / 2 - 75, // 屏幕中心偏上
      width: 200, 
      height: 150, 
      component: <CustomComponent title="任务2" description="这是另一个示例任务描述" />
    },
  ]);
  
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false }
      ),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  ).current;

  const renderGrid = () => {
    const gridLines = [];
    const numLinesX = Math.ceil((width + EXTRA_SPACE * 2) / GRID_SIZE);
    const numLinesY = Math.ceil((height + EXTRA_SPACE * 2) / GRID_SIZE);

    // 绘制垂直线
    for (let i = 0; i < numLinesX; i++) {
      gridLines.push(
        <View
          key={`v${i}`}
          style={[
            styles.gridLine,
            {
              left: i * GRID_SIZE - EXTRA_SPACE,
              height: height + EXTRA_SPACE * 2,
              width: 1,
            },
          ]}
        />
      );
    }

    // 绘制水平线
    for (let i = 0; i < numLinesY; i++) {
      gridLines.push(
        <View
          key={`h${i}`}
          style={[
            styles.gridLine,
            {
              top: i * GRID_SIZE - EXTRA_SPACE,
              width: width + EXTRA_SPACE * 2,
              height: 1,
            },
          ]}
        />
      );
    }

    return gridLines;
  };

  const itemPans = useRef(new Map()).current;

  const renderItems = () => {
    return items.map((item) => {
      if (!itemPans.has(item.id)) {
        itemPans.set(item.id, new Animated.ValueXY());
      }
      const itemPan = itemPans.get(item.id);
      
      const itemPanResponder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: Animated.event(
          [null, { dx: itemPan.x, dy: itemPan.y }],
          { useNativeDriver: false }
        ),
        onPanResponderRelease: () => {
          itemPan.extractOffset();
          // // 更新组件位置
          // setItems(items.map(i => 
          //   i.id === item.id 
          //     ? { ...i, x: i.x + (itemPan.x as any).__getValue(), y: i.y + (itemPan.y as any).__getValue() }
          //     : i
          // ));
        },
      });

      return (
        <Animated.View
          key={item.id}
          style={[
            styles.item,
            {
              left: item.x,
              top: item.y,
              width: item.width,
              height: item.height,
              transform: [
                { translateX: itemPan.x },
                { translateY: itemPan.y },
              ],
            },
          ]}
          {...itemPanResponder.panHandlers}
        >
          {item.component}
        </Animated.View>
      );
    });
  };

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.canvas,
          {
            transform: [
              { translateX: pan.x },
              { translateY: pan.y },
            ],
          },
        ]}
        {...panResponder.panHandlers}
      >
        {renderGrid()}
        {renderItems()}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: '#f5f5f5',
  },
  canvas: {
    flex: 1,
    backgroundColor: '#fff',
    width: width + EXTRA_SPACE * 2,
    height: height + EXTRA_SPACE * 2,
    position: 'absolute',
    left: -EXTRA_SPACE,
    top: -EXTRA_SPACE,
  },
  gridLine: {
    position: 'absolute',
    backgroundColor: '#e0e0e0',
  },
  item: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#2196f3',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  customComponent: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  customComponentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingBottom: 8,
  },
  customComponentTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1976d2',
  },
  customComponentContent: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});