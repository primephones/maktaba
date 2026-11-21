/**
 * The colour themes. Each is a whole palette (tokens.css), so every screen, sheet, button,
 * highlight and book's gold lettering follows it; this list is the one place the app's
 * code learns their names, light or dark, and the colours shown in the pickers.
 */
export type ThemeId = 'paper' | 'sepia' | 'lamp' | 'black' | 'forest' | 'midnight' | 'gallery' | 'terracotta';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  sub: string;
  tone: 'light' | 'dark';
  /** The screen's background: the phone's status bar and the browser's bar take it. */
  bg: string;
  /** Background, accent, text: shown as a small three-colour disc in the pickers. */
  swatch: [string, string, string];
  family: 'classic' | 'palette';
}

export const THEMES: ThemeInfo[] = [
  { id: 'paper', label: 'Paper', sub: 'Vellum and iron-gall ink', tone: 'light', bg: '#f6f4ef', swatch: ['#f6f4ef', '#a3302a', '#1d1c1a'], family: 'classic' },
  { id: 'sepia', label: 'Sepia', sub: 'Warm, low glare', tone: 'light', bg: '#f1e7d0', swatch: ['#f1e7d0', '#97291f', '#33281a'], family: 'classic' },
  { id: 'lamp', label: 'Lamp', sub: 'Dark, for evening reading', tone: 'dark', bg: '#1d1914', swatch: ['#1d1914', '#eb8a79', '#efe3cb'], family: 'classic' },
  { id: 'black', label: 'Black', sub: 'True black for OLED screens', tone: 'dark', bg: '#000000', swatch: ['#000000', '#e0796d', '#dcd6c8'], family: 'classic' },
  { id: 'forest', label: 'Forest', sub: 'Deep green, olive and sand', tone: 'dark', bg: '#17251f', swatch: ['#17251f', '#d6c99a', '#65745a'], family: 'palette' },
  { id: 'midnight', label: 'Midnight', sub: 'Charcoal and amber, for late reading', tone: 'dark', bg: '#141416', swatch: ['#141416', '#e2b868', '#2b2b30'], family: 'palette' },
  { id: 'gallery', label: 'Gallery', sub: 'Clean white, black type, a touch of orange', tone: 'light', bg: '#f5f5f2', swatch: ['#ffffff', '#111111', '#e0571f'], family: 'palette' },
  { id: 'terracotta', label: 'Terracotta', sub: 'Clay, sienna and cream', tone: 'light', bg: '#f6e8d9', swatch: ['#f6e8d9', '#a0522d', '#3e2723'], family: 'palette' },
];

export const themeInfo = (id: ThemeId): ThemeInfo => THEMES.find((t) => t.id === id) ?? THEMES[0];
export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);

/** The disc in the pickers: background with the accent and text colours as two slices. */
export const swatchStyle = (t: ThemeInfo) => ({
  background: `conic-gradient(from 200deg, ${t.swatch[1]} 0 25%, ${t.swatch[2]} 0 45%, ${t.swatch[0]} 0)`,
});
