import {StackScreenProps} from "@react-navigation/stack";
import {FlowDisplayerProps} from "@/features/flow/types";

type FlowRouteParams = {
    flowData? : FlowDisplayerProps;
}

export type RootStackParamList = {
    Home : undefined;
    History : undefined;
    Flows : FlowRouteParams;
    Storage : undefined;
}

export type HomeStackParamList = {
    Home: undefined;
    Flows: FlowRouteParams;
}

export type HistoryStackParamList = {
    History : undefined;
    Flows : FlowRouteParams;
}

export type StorageStackParamList = {
    Storage: undefined;
    Flows : FlowRouteParams;
}

export type HomeStackProps = StackScreenProps<HomeStackParamList, 'Home' | 'Flows'>;
export type HistoryStackProps = StackScreenProps<HistoryStackParamList, 'History' | 'Flows'>;
export type StorageStackProps = StackScreenProps<StorageStackParamList, 'Storage' | 'Flows'>;