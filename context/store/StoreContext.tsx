import React from "react";
import {MapDisplayerProps} from "@/features/map";
import {Paths} from "expo-file-system/next";
import {APP_DIR, isFileExist, MAP_DIR} from "@/utils/filesystem/path";
import {saveImage} from "@/utils/filesystem/image";
import {loadJsonDataSync, saveJsonDataSync, unlinkFile} from "@/utils/filesystem/file";
import useDataLoader from "@/hooks/useDataLoader";
import {FlowDisplayerProps} from "@/features/flow/types";
import {Card} from "@/types/types";


type Store = {
  [title: string]: Card[]
}

//分类文件格式
//主页需要展示最近的前10条记录包括（map、flow）
//Storage页面需要管理分类的记录
//History页面需要展示所有的记录（按时间）

interface StoreContextShape {
  data: Store;
  saveMap: (map: MapDisplayerProps, mimeType: string, group?: string) => void;
  removeHistory: () => void;
  removeMap: (filepath: string) => void;
  saveFlow: (flow: FlowDisplayerProps, group?: string) => void;
  removeFlow: (filepath: string) => void;

  addGroup: (group: string) => boolean;
  removeGroup: (group: string) => boolean;
  renameGroup: (group: string, newGroupName: string) => boolean;
  addCard: (group: string, card: Card) => boolean;
  removeCard: (group: string, card: Card) => boolean;
  moveCard: (group: string, card: Card, newGroup: string) => boolean;
}

export const DEFAULT_GROUP = "history";
const DEFAULT_DATA: Store = {
  [DEFAULT_GROUP]: [],
}

const FILE_NAME = "store.json";
const FILE_PATH = Paths.join(APP_DIR, FILE_NAME);
const StoreContext = React.createContext<StoreContextShape | undefined>(undefined);
export const StoreProvider = ({children}: { children: React.ReactNode }) => {
  const [data, updateData] = useDataLoader(FILE_PATH, DEFAULT_DATA);

  //调用saveMap时的imageUri为'data:image/png;base64,',获取map的数据的imageUris是图片在本地的文件路径
  const saveMap = async (map: MapDisplayerProps, mimeType: string, group: string = DEFAULT_GROUP) => {
    const {imageUri, title, nodes} = map;
    if (!imageUri || !title || !nodes) return;
    if (group !== DEFAULT_GROUP && !(group in data)) {
      console.log("StoreContext saveMap:", 'group不存在');
      throw new Error('group不存在');
    }

    const savePath = Paths.join(MAP_DIR, `map_${Date.now()}.json`);
    const imagePath = await saveImage(imageUri, mimeType);
    const mapData: MapDisplayerProps = {
      imageUri: imagePath ? imagePath : '',
      title: title,
      nodes: nodes,
    }
    saveJsonDataSync(savePath, mapData);
    console.log("StoreContext saveMap: mapPath", savePath);
    const mapCard: Card = {
      type: 'map',
      filepath: savePath,
      createAt: Date.now(),
      modifyAt: Date.now(),
    }

    const newData = {
      ...data,
      [group]: [...data[group] || [], mapCard],
    }
    updateData(newData);
  }
  const removeMap = (mapPath: string) => {
    if (!isFileExist(mapPath)) throw new Error('mapPath对应的文件不存在');
    const map = loadJsonDataSync(mapPath, {} as MapDisplayerProps);
    if (map.imageUri) {
      unlinkFile(map.imageUri);
    }
    unlinkFile(mapPath);
  }
  const removeHistory = () => {
    data?.[DEFAULT_GROUP].forEach((card) => {
      console.log("StoreContext removeHistory: card", card);
      if (card.type === 'map') {
        removeMap(card.filepath);
      }
      if (card.type === 'flow') {
        removeFlow(card.filepath);
      }
    })
    const newData = {
      ...data,
      [DEFAULT_GROUP]: [],
    }
    updateData(newData);
  }

  const saveFlow = async (flow: FlowDisplayerProps, group: string = DEFAULT_GROUP) => {
  }
  const removeFlow = (flowPath: string) => {
    return;
  }


  const addGroup = (group: string) => {
    if (!(group in data)) return false;
    const newData = {
      ...data,
      [group]: [],
    }
    updateData(newData);
    return true;
  }
  const removeGroup = (group: string) => {
    if (!(group in data)) return false;
    data?.[group].forEach((card) => {
      if (card.type === 'map') {
        removeMap(card.filepath);
      }
      if (card.type === 'flow') {
        removeFlow(card.filepath);
      }
    })
    const newData = {...data};
    delete newData[group];

    updateData(newData);
    return true;
  }
  const renameGroup = (group: string, newGroupName: string) => {
    if (!(group in data)) return false;
    const newData = {
      ...data,
      [newGroupName]: data[group],
    }
    delete newData[group];
    updateData(newData);
    return true;
  }
  const addCard = (group: string = DEFAULT_GROUP, card: Card) => {
    if (!(group in data)) return false;
    const newData = {
      ...data,
      [group]: [...data[group], card],
    }
    updateData(newData);
    return true;
  }
  const removeCard = (group: string, card: Card) => {
    if (!(group in data)) return false;

    data?.[group].forEach((item) => {
      if (item.filepath === card.filepath && item.type === 'map') {
        removeMap(card.filepath);
      }
      if (item.filepath === card.filepath && item.type === 'flow') {
        removeFlow(card.filepath);
      }
    })
    const newData = {
      ...data,
      [group]: data[group].filter((item) => item.filepath !== card.filepath),
    }
    updateData(newData);
    return true;
  }
  const moveCard = (group: string, card: Card, newGroup: string) => {
    if (!(group in data) || !(newGroup in data)) return false;
    const newData = {
      ...data,
      [group]: data[group].filter((item) => item.filepath !== card.filepath),
      [newGroup]: [...data[newGroup], card],
    }
    updateData(newData);
    return true;
  }

  return (
    <StoreContext.Provider
      value={{
        data,
        saveMap,
        removeMap,
        saveFlow,
        removeFlow,
        addGroup,
        renameGroup,
        removeGroup,
        removeCard,
        addCard,
        moveCard,
        removeHistory
      }}>
      {children}
    </StoreContext.Provider>
  )
}
export const useStore = () => {
  const context = React.useContext(StoreContext);
  if (context === undefined) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
}



