import { create } from 'zustand';

interface LayoutState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  theme: 'dark' | 'light';
  leftWidth: number;
  rightWidth: number;

  toggleLeft: () => void;
  toggleRight: () => void;
  toggleBottom: () => void;
  setTheme: (t: 'dark' | 'light') => void;
  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: true,
  theme: (localStorage.getItem('dkg-theme') as 'dark' | 'light') || 'dark',
  leftWidth: 240,
  rightWidth: 360,

  toggleLeft: () => set((s) => ({ leftCollapsed: !s.leftCollapsed })),
  toggleRight: () => set((s) => ({ rightCollapsed: !s.rightCollapsed })),
  toggleBottom: () => set((s) => ({ bottomCollapsed: !s.bottomCollapsed })),
  setTheme: (t) => {
    localStorage.setItem('dkg-theme', t);
    set({ theme: t });
  },
  setLeftWidth: (w) => set({ leftWidth: w }),
  setRightWidth: (w) => set({ rightWidth: w }),
}));
