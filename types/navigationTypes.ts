import {StackScreenProps} from "@react-navigation/stack";

export type RootStackParamList = {
    Home : undefined;
    History : undefined;
    Flows : undefined;
    Storage : undefined;
}

export type HomeStackParamList = {
    Home: undefined;
    Flows: undefined;
}

export type HistoryStackParamList = {
    History : undefined;
    Flows : undefined;
}

export type StorageStackParamList = {
    Storage: undefined;
    Flows : undefined;
}

export type HomeStackProps = StackScreenProps<HomeStackParamList, 'Home' | 'Flows'>;
export type HistoryStackProps = StackScreenProps<HistoryStackParamList, 'History' | 'Flows'>;
export type StorageStackProps = StackScreenProps<StorageStackParamList, 'Storage' | 'Flows'>;