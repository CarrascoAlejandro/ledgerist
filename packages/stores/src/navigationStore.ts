import { create } from 'zustand';
import type { ScreenName } from '@ledger/shared';
import { useBookStore } from './bookStore.js';
import { useEntryStore } from './entryStore.js';

interface NavigationState {
  currentScreen: ScreenName;
  currentBook_id: string | null;
  currentLedger_id: string | null;
  navigationStack: ScreenName[];
  hasUnsavedChanges: boolean;
  parserVisible: boolean;
}

interface NavigationStoreState {
  navigation: NavigationState;
  showUnsavedWarning: boolean;
  selectedSettingsTab: 'app' | 'book' | 'ledger';
}

interface NavigationActions {
  navigateTo(params: {
    screen: ScreenName;
    book_id?: string;
    ledger_id?: string;
  }): void;
  navigateBack(): void;
  openBookOverview(book_id: string): Promise<void>;
  openAppSettings(tab?: 'app' | 'book' | 'ledger'): void;
  markUnsavedChanges(hasChanges: boolean): void;
  clearUnsavedChanges(): void;
  discardUnsavedChanges(): void;

  // Getters
  getCurrentScreen(): ScreenName;
  isBookOpen(): boolean;
  isParserVisible(): boolean;
  hasUnsavedChanges(): boolean;
  canGoBack(): boolean;
}

export const useNavigationStore = create<NavigationStoreState & NavigationActions>(
  (set, get) => ({
    navigation: {
      currentScreen: 'home',
      currentBook_id: null,
      currentLedger_id: null,
      navigationStack: [],
      hasUnsavedChanges: false,
      parserVisible: false,
    },
    showUnsavedWarning: false,
    selectedSettingsTab: 'app',

    navigateTo({ screen, book_id, ledger_id }) {
      set((state) => ({
        navigation: {
          ...state.navigation,
          navigationStack: [...state.navigation.navigationStack, state.navigation.currentScreen],
          currentScreen: screen,
          currentBook_id: book_id ?? state.navigation.currentBook_id,
          currentLedger_id: ledger_id ?? state.navigation.currentLedger_id,
          parserVisible: screen === 'book_detail',
        },
      }));
    },

    navigateBack() {
      set((state) => {
        const stack = [...state.navigation.navigationStack];
        const prev = stack.pop() ?? 'home';
        return {
          navigation: {
            ...state.navigation,
            navigationStack: stack,
            currentScreen: prev,
            parserVisible: prev === 'book_detail',
          },
        };
      });
    },

    async openBookOverview(book_id) {
      await useBookStore.getState().openBook(book_id);
      get().navigateTo({ screen: 'book_detail', book_id });
    },

    openAppSettings(tab) {
      get().navigateTo({ screen: 'settings' });
      if (tab) {
        set({ selectedSettingsTab: tab });
      }
    },

    markUnsavedChanges(hasChanges) {
      set((state) => ({
        navigation: { ...state.navigation, hasUnsavedChanges: hasChanges },
      }));
    },

    clearUnsavedChanges() {
      set((state) => ({
        navigation: { ...state.navigation, hasUnsavedChanges: false },
      }));
    },

    discardUnsavedChanges() {
      useEntryStore.getState().clearParserState();
      set((state) => ({
        navigation: { ...state.navigation, hasUnsavedChanges: false },
        showUnsavedWarning: false,
      }));
    },

    getCurrentScreen() {
      return get().navigation.currentScreen;
    },

    isBookOpen() {
      return get().navigation.currentBook_id !== null;
    },

    isParserVisible() {
      return get().navigation.parserVisible;
    },

    hasUnsavedChanges() {
      return get().navigation.hasUnsavedChanges;
    },

    canGoBack() {
      return get().navigation.navigationStack.length > 0;
    },
  }),
);
