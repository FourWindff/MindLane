import {MapDisplayerProps} from "@/features/map/MapDisplayer";


const FILE_EXTENSION = ".mindlane";
//记忆宫殿的上下文操作
//保存、删除、获取
interface MapStoreState {
  maps: MapDisplayerProps[];
}

type MapStoreAction =
  | { type: "save", map: MapDisplayerProps }
  | { type: "remove", map: MapDisplayerProps }
  | { type: "get", map: MapDisplayerProps }

const initialState: MapStoreState = {
  maps: [],
};

function reducer(state: MapStoreState, action: MapStoreAction): MapStoreState {
  switch (action.type) {
    case "save":
      return {
        ...state,
        maps: [...state.maps, action.map],
      };
    case "remove":
      return {
        ...state,
        maps: state.maps.filter((map) => map.imageUri !== action.map.imageUri),
      };
    case "get":
      return {
        ...state,
        maps: state.maps.filter((map) => map.imageUri === action.map.imageUri),
      };
    default:
      return state;
  }
}