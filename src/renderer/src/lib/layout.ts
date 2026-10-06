// Responsive layout state, derived from the window/main-area size (see App).
import { create } from 'zustand'

export const SIDEBAR_BREAKPOINT = 1000 // below this window width the label sidebar becomes a drawer
export const LIST_MIN = 300
export const PANE_MIN = 380

interface Layout {
  mainWidth: number
  narrow: boolean // sidebar folded into a drawer
  drawerOpen: boolean
  split: boolean // list and reading pane side by side
}

export const useLayout = create<Layout>(() => ({
  mainWidth: window.innerWidth,
  narrow: window.innerWidth < SIDEBAR_BREAKPOINT,
  drawerOpen: false,
  split: true
}))

export const setDrawer = (open: boolean): void => useLayout.setState({ drawerOpen: open })
