import {Button, Chip, useTheme,Card as PPCard, Surface, Text, Snackbar} from "react-native-paper";
import {ScrollView,StyleSheet, View,TouchableOpacity } from "react-native";
import MapDisplayer, {MapAiResponse, MapDisplayerProps} from '@/features/map';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {DEFAULT_GROUP, useStore} from "@/context/store/StoreContext";
import {Card} from "@/types/types";
import {BottomSheetBackdrop, BottomSheetModal, BottomSheetModalProvider, BottomSheetView } from '@gorhom/bottom-sheet';
import {loadJsonDataSync} from "@/utils/filesystem/file";

export default function HistoryRoute() {
  const newMap = {} as MapDisplayerProps;

  const theme = useTheme();
  //状态管理
  const [map, setMap] = useState<MapDisplayerProps | undefined>(undefined);
  let [showtypes, setButtons] = useState<string[]>(['history']);
  let [recordtypes, updatetypes] = useState<string[]>([]);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  const [deletesnackbarVisible, setdeleteSnackbarVisible] = useState(false);
  const [foldersnackbarVisible, setfolderSnackbarVisible] = useState(false);
  //获取数据
  const {data,removeCard,addCard} = useStore();
  recordtypes = Object.keys(data);
  
  //抽屉初始化
  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const bottomMapModalRef = useRef<BottomSheetModal>(null);
  const bottomChangeModalRef = useRef<BottomSheetModal>(null);
  const bottomFolderModalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["65", "70"], []);

  const removeButton = (index: number) => {
    setButtons(showtypes.filter((_, i) => i !== index));
  };
  const toggleSheet = () => {
    if (!isSheetOpen) {
      bottomSheetModalRef.current?.present();
      setIsSheetOpen(true);
    } else {
      bottomSheetModalRef.current?.dismiss();
      setIsSheetOpen(false);
    }
  };
  const cardchangeshow = () => {
    if (!isChangeModalOpen) {
      bottomChangeModalRef.current?.present();
      setIsChangeModalOpen(true);
    } else {
      bottomChangeModalRef.current?.dismiss();
      setIsChangeModalOpen(false);
    }
  };

  const handleCategoryPress = (category: string) => {
    if (showtypes.includes(category)) {
      setButtons(showtypes.filter(c => c !== category));
    } else {
      setButtons([...showtypes, category]);
    }
  };
  const handleReviewCard = (cardPath: string) => {
    const data = loadJsonDataSync(cardPath, {} as MapDisplayerProps);
    setMap(data);
    bottomMapModalRef.current?.present();
  }
    const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        pressBehavior='close'
        appearsOnIndex={1}
        style={{
          backgroundColor: '(0,0,0,0.5)',
        }}
      />
    ),
    []
  );
  const handleSheetChanges = useCallback((index: number) => {
      if (index === -1) {
        setMap(undefined);
      }
      console.log("handleSheetChanges", index);
    }, []);
  const BottomMapModal = () => {
      return (
        <View style={{
          width: '100%',
          height: '100%'
        }}>
          <MapDisplayer title={map?.title} nodes={map?.nodes} imageUri={map?.imageUri}/>
        </View>
      )
    }
  function getDateLabel(timestamp: number) {
  const date = new Date(timestamp);
  const now = new Date();
  const mins = date.getMinutes() < 10 ? '0' + date.getMinutes() : '' + date.getMinutes();
  const hours = date.getHours() < 10 ? '0' + date.getHours() : '' + date.getHours();
  const day = date.getDate() < 10 ? '0' + date.getDate() : '' + date.getDate();
  const month = date.getMonth() + 1 < 10 ? '0' + (date.getMonth() + 1) : '' + (date.getMonth() + 1);
  // 今天
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return '今天 '+ hours + ':' + mins;
  }

  // 昨天
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return '昨天 '+ hours + ':' + mins;
  }

  // 其他日期
  return (month)+'.'+day+' '+ date.getHours() + ':' + mins;
}
  return (
    <BottomSheetModalProvider>
    <View style={{flex: 1,flexDirection:'column'}}>
      <Text variant="titleLarge"style={{fontWeight: 'bold',
        fontStyle: 'italic',
        marginTop: 24,        // 顶部留白
      marginBottom: 24,     // 标题和下方控件间距
      alignSelf: 'center',  // 居中可选
      }}>History</Text>
      <View style = {{flexDirection:'row'}}>
        <ScrollView
        style={{
              maxHeight: 60,
            }}
            horizontal={true}
            contentContainerStyle={{
              maxHeight:40,// 设置内容容器的最大高度
              gap: 8,// 设置子元素之间的间距
              paddingHorizontal: 20,// 设置水平方向的内边距
              marginVertical: 0,// 设置垂直方向的外边距
              alignItems: 'center',// 设置子元素的水平对齐方式
            }}>
            {showtypes.map((chip, index) => (
            <Chip
              key={index}
              style={styles.chip}
              onPress={() => console.log(`${chip} pressed`)}
              selectedColor={theme.colors.primary}
              onClose={() => removeButton(index)}
              closeIcon="close"
            >
              {chip}
            </Chip>
          ))}
        </ScrollView>
        <Button mode = 'contained' 
        style = {styles.shaixuanbutton} 
        contentStyle = {styles.buttonContent}
        onPress={toggleSheet}>筛选</Button>
      </View>
      <ScrollView
      contentContainerStyle={{
      flexDirection:'column',
      marginLeft: 1,
      gap: 1,
      padding: 10,
    }}>
      {showtypes
    .flatMap(type => data[type] || [])
    .filter((card, idx, arr) =>
      arr.findIndex(c => c.filepath === card.filepath) === idx // 去重
    )
    .slice().reverse().map((card, index) => {
        const cardData = loadJsonDataSync(card.filepath, newMap);
        return(
              <PPCard
              key = {index}
              style={{
              }}
              onPress={() => handleReviewCard(card.filepath)}>
                <Surface style={{
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                }} 
                elevation={4}>
                  <View style={{ flexDirection: 'row', 
                    alignItems: 'center', 
                    width: '100%', }}>
                    <PPCard.Cover
                      source={{ uri: cardData.imageUri }}
                      style={[{
                  height: 100,
                  width: 100,
                }, { marginRight: 16 }]}
                      resizeMode="cover"
                    />
                    <View style={{ flex: 1, justifyContent: 'center',flexDirection: 'column' }}>
                      <Text
                        variant="titleLarge"
                        ellipsizeMode="tail"
                        numberOfLines={1}
                        style={{ color: theme.colors.onBackground, fontWeight: 'bold', textAlign: 'center' }}
                      >
                        {cardData.title}
                      </Text>
                      <Text
                        variant="bodyMedium"
                        ellipsizeMode="tail"
                        numberOfLines={2}
                        style={{ color: theme.colors.onBackground, textAlign: 'center' }}
                      >
                        {getDateLabel(card.createAt)}
                      </Text>
                    </View>
                    <Button
                      onPress={() => {
                        setSelectedCard(card);
                        cardchangeshow();
                      }}
                      mode={"contained-tonal"}
                      style={{ marginLeft: 16 }}
                    >
                      ...
                    </Button>
                  </View>
                </Surface>
              </PPCard>
              )})}
    </ScrollView>
      
    </View>
    <BottomSheetModal //筛选栏抽屉设计
      index={1}
      ref={bottomSheetModalRef}
      snapPoints={['30%', '65%']}
      enableDynamicSizing={true}
    >
      <BottomSheetView style={styles.bottomSheetContainer}>
        {recordtypes.map((category, index) => (
          <Chip
            key={index}
            style={styles.categoryChip}
            onPress={() => handleCategoryPress(category)}
            selected={showtypes.includes(category)}
            selectedColor={theme.colors.primary}
          >
            {category}
          </Chip>
        ))}
      </BottomSheetView>
    </BottomSheetModal>
    <BottomSheetModal //记忆宫殿展示设计
      backdropComponent={renderBackdrop}
      ref={bottomMapModalRef}
      snapPoints={snapPoints}
      index={1}
      onChange={handleSheetChanges}
      enableDynamicSizing={true}
    >
      <BottomSheetView>
        <BottomMapModal/>
      </BottomSheetView>
    </BottomSheetModal>
    <BottomSheetModal 
      style={styles.bottomSheetContainer}
      index={1}
      ref = {bottomChangeModalRef}
      snapPoints={['30%', '65%']}
      enableDynamicSizing={true}>
        <BottomSheetView style={{
          flexDirection:'column',
          gap: 8,
        }}>
          <Text>
            对{selectedCard ? loadJsonDataSync(selectedCard.filepath, newMap).title : ''}的操作
          </Text>
          <Chip
          selectedColor={theme.colors.primary}
          onPress={() => {
            if (selectedCard?.filepath) {
              bottomFolderModalRef.current?.present();
            }
          }}>
            移动到新标签
          </Chip>
          <Chip
          onPress={() => {
              if (selectedCard) {
                removeCard(DEFAULT_GROUP, selectedCard);
                cardchangeshow();
                setTimeout(() => setdeleteSnackbarVisible(true), 300);
                setSelectedCard(null);
              }
            }}
          selectedColor={theme.colors.primary}>
            删除
          </Chip>
        </BottomSheetView>
    </BottomSheetModal>
    <BottomSheetModal //移动到新收藏夹的抽屉设计
      style={styles.bottomSheetContainer}
      index={1}
      ref = {bottomFolderModalRef}
      snapPoints={['30%', '65%']}
      enableDynamicSizing={true}>
        <BottomSheetView style={{
          flexDirection:'column',
          gap: 8,
        }}>
          {recordtypes.filter(folder => folder !== DEFAULT_GROUP &&
            !data[folder]?.some(item => item.filepath === selectedCard?.filepath)
          ).map((category, index) => (
          <Chip
            key={index}
            style={styles.categoryChip}
            onPress={() => {
            if (selectedCard?.filepath) {
              addCard(category, selectedCard);
              setTimeout(() => setfolderSnackbarVisible(true), 300);
              bottomFolderModalRef.current?.dismiss();
              setTimeout(() => cardchangeshow(), 300);
            }
          }}
            selectedColor={theme.colors.primary}
          >
            {category}
          </Chip>
        ))}
        </BottomSheetView>
    </BottomSheetModal>
    <Snackbar
      visible={deletesnackbarVisible}
      onDismiss={() => setdeleteSnackbarVisible(false)}
      duration={1500}
    >
      删除成功
    </Snackbar>
    <Snackbar
      visible={foldersnackbarVisible}
      onDismiss={() => setfolderSnackbarVisible(false)}
      duration={1500}
    >
      移动到新收藏夹成功
    </Snackbar>
    </BottomSheetModalProvider>
  )

}
const styles = StyleSheet.create({
  shaixuanbutton: {//筛选按钮的样式
    borderRadius:4,
    height:40,// 设置内容容器的最大高度
    paddingHorizontal: 5,// 设置水平方向的内边距
    marginVertical: 0,// 设置垂直方向的外边距
    marginHorizontal:5,// 设置垂直方向的外边距
    alignItems: 'center',// 设置子元素的水平对齐方式
  },
  buttonContent: {//按钮文本内容格式的样式
    justifyContent: 'center', // 垂直居中
    alignItems: 'center', // 水平居中
  },
  chip: {//分类栏的chip样式设置
    margin: 5,
  },
  bottomSheetContainer: {
    padding: 16,
    gap: 8,
  },
  categoryChip: {
    margin: 4,
  },
})
