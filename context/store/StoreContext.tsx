import React from "react";
import { Paths } from "expo-file-system/next";
import {
  APP_DIR,
  FLOW_DIR,
  isFileExist,
  MAP_DIR,
} from "@/utils/filesystem/path";
import { saveImage } from "@/utils/filesystem/image";
import {
  loadJsonDataSync,
  saveJsonDataSync,
  unlinkFile,
} from "@/utils/filesystem/file";
import useDataLoader from "@/hooks/useDataLoader";
import { Card } from "@/types/types";
import { FlowDisplayerProps } from "@/features/flow/types";
import { MapDisplayerProps } from "@/features/map/types";

type Store = {
  [title: string]: Card[];
};

//分类文件格式
//主页需要展示最近的前10条记录包括（map、flow）
//Storage页面需要管理分类的记录
//History页面需要展示所有的记录（按时间）

interface StoreContextShape {
  data: Store;
  saveMap: (
    map: MapDisplayerProps,
    mimeType: string,
    group?: string
  ) => Promise<string>;
  removeHistory: () => void;
  removeMap: (filepath: string) => void;
  saveFlow: (
    flow: FlowDisplayerProps,
    mimeType?: "image/png",
    group?: string
  ) => Promise<string>;
  removeFlow: (filepath: string) => void;
  addGroup: (group: string) => boolean;
  removeGroup: (group: string) => boolean;
  renameGroup: (group: string, newGroupName: string) => boolean;
  addCard: (group: string, card: Card) => boolean;
  removeCard: (group: string, card: Card) => boolean;
  moveCard: (card: Card, newGroup: string, group?: string) => boolean;
  removeAll: () => void;
}

export const DEFAULT_GROUP = "history";
const DEFAULT_DATA: Store = {
  [DEFAULT_GROUP]: [],
};

const FILE_NAME = "store.json";
const FILE_PATH = Paths.join(APP_DIR, FILE_NAME);
const StoreContext = React.createContext<StoreContextShape | undefined>(
  undefined
);
export const StoreProvider = ({ children }: { children: React.ReactNode }) => {
  const [data, updateData] = useDataLoader(FILE_PATH, DEFAULT_DATA);

  /**
   * 保存思维导图数据
   * @param map - 思维导图数据，包含图片URI、标题和节点信息,其中的imageUri是不包含头信息的base64字符串，
   * @param mimeType - 图片的MIME类型
   * @param group - 保存的分组名称，默认为"history"
   * @returns 保存的文件路径
   */
  const saveMap = async (
    map: MapDisplayerProps,
    mimeType: string,
    group: string = DEFAULT_GROUP
  ) => {
    const { imageUri, title, nodes } = map;

    if (group !== DEFAULT_GROUP && !(group in data)) {
      console.log("StoreContext saveMap:", "group不存在");
      throw new Error("group不存在");
    }

    const savePath = Paths.join(MAP_DIR, `map_${Date.now()}.json`);
    const imagePath = await saveImage(imageUri, mimeType);
    const mapData: MapDisplayerProps = {
      imageUri: imagePath ? imagePath : "",
      title: title,
      nodes: nodes,
    };
    saveJsonDataSync(savePath, mapData);
    console.log("StoreContext saveMap: mapPath", savePath);
    const mapCard: Card = {
      title: map.title,
      type: "map",
      filepath: savePath,
      createAt: Date.now(),
      modifyAt: Date.now(),
    };

    const newData = {
      ...data,
      [group]: [...(data[group] || []), mapCard],
    };
    updateData(newData);
    return savePath;
  };
  const removeMap = (mapPath: string) => {
    if (!isFileExist(mapPath)) throw new Error("mapPath对应的文件不存在");
    const map = loadJsonDataSync<MapDisplayerProps>(mapPath);
    if (map?.imageUri) {
      unlinkFile(map.imageUri);
    }
    unlinkFile(mapPath);
  };
  const removeHistory = () => {
    data?.[DEFAULT_GROUP].forEach((card) => {
      console.log("StoreContext removeHistory: card", card);
      if (card.type === "map") {
        removeMap(card.filepath);
      }
      if (card.type === "flow") {
        removeFlow(card.filepath);
      }
    });
    const newData = {
      ...data,
      [DEFAULT_GROUP]: [],
    };
    updateData(newData);
  };
  const removeAll = () => {
    console.log("StoreContext removeAll");
    const newData = {};
    updateData(newData);
  };
  // TODO: 仅仅是更改了上面map的文件操作实现了flow基本的文件操作，需要优化--如缩略图等

  const saveFlow = async (
    flow: FlowDisplayerProps,
    mimeType?: "image/png",
    group: string = DEFAULT_GROUP
  ) => {
    const { answer, title, nodes, imageUri } = flow;
    if (group !== DEFAULT_GROUP && !(group in data)) {
      console.log("StoreContext saveMap:", "group不存在");
      throw new Error("group不存在");
    }

    const savePath = Paths.join(FLOW_DIR, `flow_${Date.now()}.json`);
    const imagePath = await saveImage(imageUri, mimeType);
    const flowData: FlowDisplayerProps = {
      imageUri: imagePath ? imagePath : "",
      answer: answer,
      title: title,
      nodes: nodes,
    };
    saveJsonDataSync(savePath, flowData);
    console.log("StoreContext saveMap: mapPath", savePath);
    const flowCard: Card = {
      title: flow.title,
      type: "flow",
      filepath: savePath,
      createAt: Date.now(),
      modifyAt: Date.now(),
    };

    const newData = {
      ...data,
      [group]: [...(data[group] || []), flowCard],
    };
    updateData(newData);
    return savePath;
  };
  const removeFlow = (flowPath: string) => {
    if (!isFileExist(flowPath)) throw new Error("mapPath对应的文件不存在");
    const flow = loadJsonDataSync<FlowDisplayerProps>(flowPath);
    if (flow?.imageUri) {
      unlinkFile(flow.imageUri);
    }
    unlinkFile(flowPath);
    return;
  };
  const addGroup = (group: string) => {
    if (group in data) return false;
    if (group.trim() === "") return false;
    const newData = {
      ...data,
      [group]: [],
    };
    updateData(newData);
    return true;
  };
  const removeGroup = (group: string) => {
    if (!(group in data)) return false;
    data?.[group].forEach((card) => {
      if (card.type === "map") {
        removeMap(card.filepath);
      }
      if (card.type === "flow") {
        removeFlow(card.filepath);
      }
    });
    const newData = { ...data };
    delete newData[group];

    updateData(newData);
    return true;
  };
  const renameGroup = (group: string, newGroupName: string) => {
    if (!(group in data)) return false;
    const newData = {
      ...data,
      [newGroupName]: data[group],
    };
    delete newData[group];
    updateData(newData);
    return true;
  };
  const addCard = (group: string = DEFAULT_GROUP, card: Card) => {
    if (!(group in data)) return false;
    const newData = {
      ...data,
      [group]: [...data[group], card],
    };
    updateData(newData);
    return true;
  };
  const removeCard = (group: string, card: Card) => {
    if (!(group in data)) return false;
    data?.[group].forEach((item) => {
      if (item.filepath === card.filepath && item.type === "map") {
        removeMap(card.filepath);
      }
      if (item.filepath === card.filepath && item.type === "flow") {
        removeFlow(card.filepath);
      }
    });
    const newData = {
      ...data,
      ["history"]: data["history"].filter(
        (item) => item.filepath !== card.filepath
      ),
      [group]: data[group].filter((item) => item.filepath !== card.filepath),
    };
    updateData(newData);
    return true;
  };
  const moveCard = (
    card: Card,
    newGroup: string,
    group: string = DEFAULT_GROUP
  ) => {
    if (!(group in data) || !(newGroup in data)) throw new Error("group or newGroup not in store")
    if (group === newGroup) return false;
    const newData = {
      ...data,
      [group]: data[group].filter((item) => item.filepath !== card.filepath),
      [newGroup]: [...data[newGroup], card],
    };
    updateData(newData);
    return true;
  };

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
        removeHistory,
        removeAll,
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};
export const useStore = () => {
  const context = React.useContext(StoreContext);
  if (context === undefined) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
};
