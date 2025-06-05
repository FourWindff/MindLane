import {Button, Chip, useTheme,Card as PPCard, Surface, Text, Snackbar,Dialog, Portal, TextInput, IconButton} from "react-native-paper";
import {ScrollView,StyleSheet, View,TouchableOpacity } from "react-native";
import MapDisplayer, {MapAiResponse, MapDisplayerProps} from '@/features/map';
import React, {useCallback, useMemo, useRef, useState,useEffect} from 'react';
import {DEFAULT_GROUP, useStore} from "@/context/store/StoreContext";
import {Card} from "@/types/types";
import {BottomSheetBackdrop, BottomSheetModal, BottomSheetModalProvider, BottomSheetView } from '@gorhom/bottom-sheet';
import {loadJsonDataSync} from "@/utils/filesystem/file";

export default function StorageRoute() {
  const newMap = {} as MapDisplayerProps;
  
  const theme = useTheme();
  let [recordtypes, updatetypes] = useState<string[]>([]);
  const [map, setMap] = useState<MapDisplayerProps | undefined>(undefined);
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [isChangeModalOpen, setIsChangeModalOpen] = useState(false);
  const [deletesnackbarVisible, setdeleteSnackbarVisible] = useState(false);
  const [foldersnackbarVisible, setfolderSnackbarVisible] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isFolderActionSheetOpen, setIsFolderActionSheetOpen] = useState(false);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const {data,removeCard,addGroup,removeGroup,renameGroup,moveCard} = useStore();
  const folders = Object.keys(data).filter(folder => folder !== DEFAULT_GROUP);
  recordtypes = Object.keys(data);
  //抽屉初始化
  const bottomMapModalRef = useRef<BottomSheetModal>(null);
  const bottomChangeModalRef = useRef<BottomSheetModal>(null);
  const bottomFolderModalRef = useRef<BottomSheetModal>(null);
  const bottomnewFolderModalRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["65", "70"], []);
  const toggleExpand = (name: string) => {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }));
  };
  const handleAddGroup = () => {
    if (newGroupName.trim()) {
      addGroup(newGroupName.trim());
    }
    setDialogVisible(false);
    setNewGroupName("");
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

  const cardchangeshow = () => {
    if (!isChangeModalOpen) {
      bottomChangeModalRef.current?.present();
      setIsChangeModalOpen(true);
    } else {
      bottomChangeModalRef.current?.dismiss();
      setIsChangeModalOpen(false);
    }
  };
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
    useEffect(() => {
    if (isFolderActionSheetOpen) {
      bottomFolderModalRef.current?.present();
    }
  }, [isFolderActionSheetOpen]);
  return (
    <BottomSheetModalProvider>
    <ScrollView style={styles.container}>
      <Text variant="titleLarge"
      style={{fontWeight: 'bold',
        fontStyle: 'italic',
        marginTop: 24,        // 顶部留白
      marginBottom: 24,     // 标题和下方控件间距
      alignSelf: 'center',  // 居中可选
      }}>Storage</Text>
      {folders.length !== 0 && folders.map(folder => {
        const folderData: Card[] = data?.[folder] || [];
        return (
          <View key={folder} style={{ marginBottom: 12, width: '100%', alignItems: 'stretch' }}>
            <Chip
              style={styles.chip}
              onPress={() => {toggleExpand(folder);
                setSelectedFolder(folder);} // 点击时设置选中的文件夹
              }
              onLongPress={() => {
                setSelectedFolder(folder);
                setIsFolderActionSheetOpen(true);
                bottomFolderModalRef.current?.present;
              }}
              selected={!!expanded[folder]}
            >
              {folder}
            </Chip>
            {expanded[folder] && (
              <View style={styles.content}>
                <ScrollView
                  contentContainerStyle={{
                    flexDirection: 'column',
                    marginLeft: 1,
                    gap: 1,
                    padding: 0,
                    alignItems: 'stretch',
                  }}>
                  {folderData.slice().reverse().map((card, index) => {
                    const cardData = loadJsonDataSync(card.filepath, newMap);
                    return (
                      <PPCard
                        key={index}
                        style={{
                          width: '100%',
                        }}
                        onPress={() => handleReviewCard(card.filepath)}>
                        <Surface style={{
                          borderRadius: 20,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                          elevation={4}>
                          <View style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            width: '100%',
                          }}>
                            <PPCard.Cover
                              source={{ uri: cardData.imageUri }}
                              style={[{
                                height: 100,
                                width: 100,
                              }, { marginRight: 16 }]}
                              resizeMode="cover"
                            />
                            <View style={{ flex: 1, justifyContent: 'center' }}>
                              <Text
                                variant="titleLarge"
                                ellipsizeMode="tail"
                                numberOfLines={1}
                                style={{ color: theme.colors.onBackground, fontWeight: 'bold', textAlign: 'center' }}
                              >
                                {cardData.title}
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
                    )
                  })}
                </ScrollView>
              </View>
            )}
          </View>
        );
      })}
      <View
        style={{
          marginLeft: 2,
          alignContent: 'flex-start',
        }}>
        <Chip
          icon="plus"
          style={{
            width: 35,         // 固定宽度
            height: 35,        // 固定高度
            justifyContent: 'center',
            alignItems: 'center',
            paddingHorizontal: 0, // 去除左右内边距
          }}
          onPress={() => {
            setDialogVisible(true)
          }}
          selectedColor={theme.colors.primary}>
            .
        </Chip>
      </View>
    </ScrollView>
    <Portal>
    <Dialog visible={renameDialogVisible} onDismiss={() => setRenameDialogVisible(false)}>
      <Dialog.Title>重命名文件夹</Dialog.Title>
      <Dialog.Content>
        <TextInput
          label="新名称"
          value={renameValue}
          onChangeText={setRenameValue}
          autoFocus
        />
      </Dialog.Content>
      <Dialog.Actions>
        <IconButton icon="close" onPress={() => setRenameDialogVisible(false)} />
        <IconButton
          icon="check"
          onPress={() => {
            if (selectedFolder && renameValue.trim()) {
              renameGroup(selectedFolder, renameValue.trim());
              setRenameDialogVisible(false);
              setSelectedFolder(null);
            }
          }}
          disabled={!renameValue.trim()}
        />
      </Dialog.Actions>
    </Dialog>
  </Portal> 
    <Portal>
      <Dialog visible={dialogVisible} onDismiss={() => setDialogVisible(false)}>
        <Dialog.Title>新建文件夹</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label="文件夹名称"
            value={newGroupName}
            onChangeText={setNewGroupName}
            autoFocus
          />
        </Dialog.Content>
        <Dialog.Actions style={{ justifyContent: "flex-end" }}>
          <IconButton
            icon="close"
            onPress={() => {
              setDialogVisible(false);
              setNewGroupName("");
            }}
          />
          <IconButton
            icon="check"
            onPress={() =>{
              handleAddGroup();
              setIsFolderActionSheetOpen(false);
            }}
            disabled={!newGroupName.trim()}
          />
        </Dialog.Actions>
      </Dialog>
    </Portal>
    <BottomSheetModal //对收藏夹的操作
      ref={bottomFolderModalRef}
      index={0}
      snapPoints={['25%']}
      onDismiss={() => setIsFolderActionSheetOpen(false)}
      enableDynamicSizing={true}
    >
      <BottomSheetView style={{gap: 12, padding: 16}}>
        <Text>
          对{selectedFolder}的操作
        </Text>
        <Button
          icon="pencil"
          mode="outlined"
          onPress={() => {
            setRenameDialogVisible(true);
            setIsFolderActionSheetOpen(false);
            setRenameValue(selectedFolder || "");
          }}
        >
          重命名
        </Button>
        <Button
          icon="delete"
          mode="contained"
          onPress={() => {
            if (selectedFolder) {
              removeGroup(selectedFolder);
            }
            bottomFolderModalRef.current?.dismiss();
            setIsFolderActionSheetOpen(false);
            setSelectedFolder(null);
          }}
          style={{backgroundColor: theme.colors.error}}
        >
          删除
        </Button>
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
            <Chip
            onPress={bottomnewFolderModalRef.current?.present}
            selectedColor={theme.colors.primary}>
              移动到新标签
            </Chip>
            <Chip
            onPress={() => {
                if (selectedCard&&selectedFolder) {
                  removeCard(selectedFolder, selectedCard);
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
          ref = {bottomnewFolderModalRef}
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
                if (selectedCard?.filepath&&selectedFolder) {
                  moveCard(selectedFolder, selectedCard,category);
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
          删除成功
        </Snackbar>
   </BottomSheetModalProvider>
  )
}
const styles = StyleSheet.create({
  container: { flex: 1,width: '100%'},
  chip: { marginBottom: 4 },
  content: { backgroundColor: '#f0f0f0', padding: 8, borderRadius: 8, marginTop: 4 },
  item: { paddingVertical: 2, paddingLeft: 8 },
  bottomSheetContainer: {
    padding: 16,
    gap: 8,
  },
  categoryChip: {
    margin: 4,
  },
});