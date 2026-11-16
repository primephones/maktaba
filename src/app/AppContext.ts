import { createContext, useContext } from 'react';

export interface AppActions {
  /** Opens the file picker to add books, optionally straight into a folder. */
  addBooks: (folderId?: string) => void;
}

export const AppContext = createContext<AppActions>({ addBooks: () => undefined });
export const useApp = () => useContext(AppContext);
