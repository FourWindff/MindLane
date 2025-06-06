import { SCREEN_HEIGHT } from "@gorhom/bottom-sheet";


//务必保证 SHEET_HEIGHT_RATE 和 STATIC_SHEET_SNAP_POINTS 的百分比一致
export const SHEET_HEIGHT_RATE = 0.3
export const STATIC_SHEET_SNAP_POINTS = ['30%', '30%']
export const SHEET_END_HEIGHT = SCREEN_HEIGHT * (1 - SHEET_HEIGHT_RATE)