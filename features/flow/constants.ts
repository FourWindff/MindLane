import { Dimensions } from 'react-native';

// 窗口尺寸
const { width, height } = Dimensions.get('window');
export const SCREEN_WIDTH = width;
export const SCREEN_HEIGHT = height;
export const BOX_LENGTH = Math.max(SCREEN_WIDTH, SCREEN_HEIGHT);
// 网格相关常量
export const GRID_SIZE = 20;
export const EXTRA_SPACE = 100;
const ROUND_LENGTH = Math.floor((BOX_LENGTH + EXTRA_SPACE * 2) / GRID_SIZE) * GRID_SIZE;
export const DRAFT_LENGTH = ((ROUND_LENGTH / GRID_SIZE) & 1) == 1 ? ROUND_LENGTH + GRID_SIZE : ROUND_LENGTH;
export const DRAFT_ORIGIN_X = DRAFT_LENGTH / 2;
export const DRAFT_ORIGIN_Y = DRAFT_LENGTH / 2;
export const GRID_COUNT = DRAFT_LENGTH / GRID_SIZE;
// 缩放限制
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3;

