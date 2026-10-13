import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppStore {
  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;

  isSidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  expandedMenuIds: string[];
  toggleMenuExpand: (menuId: string) => void;
  setMenuExpanded: (menuId: string, expanded: boolean) => void;

  activeMenuId: string | null;
  setActiveMenu: (menuId: string | null) => void;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      isSidebarOpen: true,
      sidebarWidth: 260,
      toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),

      expandedMenuIds: [],
      toggleMenuExpand: (menuId) =>
        set((s) => ({
          expandedMenuIds: s.expandedMenuIds.includes(menuId)
            ? s.expandedMenuIds.filter((id) => id !== menuId)
            : [...s.expandedMenuIds, menuId],
        })),
      setMenuExpanded: (menuId, expanded) =>
        set((s) => ({
          expandedMenuIds: expanded
            ? Array.from(new Set([...s.expandedMenuIds, menuId]))
            : s.expandedMenuIds.filter((id) => id !== menuId),
        })),

      activeMenuId: null,
      setActiveMenu: (menuId) => set({ activeMenuId: menuId }),
    }),
    {
      name: 'mes-app-state',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (s) => ({
        isSidebarOpen: s.isSidebarOpen,
        sidebarWidth: s.sidebarWidth,
        expandedMenuIds: s.expandedMenuIds,
      }),
    }
  )
);
