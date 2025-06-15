export type CardType = "map" | "flow";
export type SortType =
  | "alpha-asc"
  | "alpha-desc"
  | "create-time-asc"
  | "create-time-desc"
  | "modify-time-asc"
  | "modify-time-desc";

export type Card = {
  title: string;
  type: CardType;
  filepath: string;
  createAt: number;
  modifyAt?: number;
};
