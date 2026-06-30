export interface AppViewState {
  activePage: "chat" | "settings";
}

export const initialAppViewState: AppViewState = {
  activePage: "chat",
};
