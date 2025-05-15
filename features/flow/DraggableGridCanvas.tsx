import { ReactNode, useRef, useState } from "react";
import { Animated, Dimensions, PanResponder, StyleSheet, Text, View } from "react-native";

const GRID_SIZE = 20; // 网格大小
const { width, height } = Dimensions.get('window');
const SCREEN_WIDTH = width;
const SCREEN_HEIGHT = height;
const EXTRA_SPACE = 500; // 额外空间，确保画布可以延伸
const DRAFT_WIDTH = SCREEN_WIDTH + EXTRA_SPACE * 2;
const DRAFT_HEIGHT = SCREEN_HEIGHT + EXTRA_SPACE * 2;

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
//该文件是我做自由画布的一个尝试。
//实现了移动画布以及在画布上放置自定义组件。
export default function DraggableGridCanvas() {
  const pan = useRef(new Animated.ValueXY({
    x: 0,
    y: 0
  })).current;

  const [scale, setScale] = useState(1);
  const [items, setItems] = useState<CanvasItem[]>([
    {
      id: '1',
      x: 0, // 屏幕中心偏左
      y: 0, // 屏幕中心偏上
      width: 300,
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
      onPanResponderMove(e, gestureState) {
        const panX: number = (pan.x as any)._offset;
        const panY: number = (pan.y as any)._offset;
        const dX: number = gestureState.dx;
        const dY: number = gestureState.dy
        console.log("画布：", panX, panY)
        console.log("手势：", dX, dY)
        if (panX + dX < - EXTRA_SPACE * 2) {
          console.log("画布右边界超出范围");
          return ;
        }
        if (panX + dX > 0) {
          console.log("画布左边界超出范围");
          return ;
        }
        if(panY + dY < - EXTRA_SPACE * 2) {
          console.log("画布下边界超出范围");
          return ;
        }
        if(panY + dY > 0) {
          console.log("画布上边界超出范围");
          return ;
        }



        pan.setValue({
          x: gestureState.dx,
          y: gestureState.dy,
        })
      },
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
              left: i * GRID_SIZE,
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
              top: i * GRID_SIZE,
              width: width + EXTRA_SPACE * 2,
              height: 1,
            },
          ]}
        />
      );
    }

    return gridLines
  };

  const renderOrigin = () => {
    return (
      <View
        style={{
          position: 'absolute',
          width: 10,
          height: 10,
          backgroundColor: 'red',
          borderRadius: 5,
          left: width + EXTRA_SPACE,
          top: height + EXTRA_SPACE,
          transform: [
            { translateX: -5 },
            { translateY: -5 },
          ],
        }}
      />
    );
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
        onPanResponderMove: (e, gestureState) => {
          itemPan.setValue({
            x: gestureState.dx,
            y: gestureState.dy
          })
        },
        onPanResponderRelease: () => {
          itemPan.extractOffset();
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
        {renderOrigin()}
        {renderItems()}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  canvas: {
    backgroundColor: '#333333',
    width: width + EXTRA_SPACE * 2,
    height: height + EXTRA_SPACE * 2,
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