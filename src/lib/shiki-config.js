/**
 * Single Shiki configuration shared by the article pipeline and the lazy
 * Agent-entry panel. Keep the two themes in sync with src/app/globals.css:
 * colors are emitted as --shiki-light/--shiki-dark custom properties
 * (defaultColor: false), and the CSS picks the one for the active html theme.
 */
export const SHIKI_THEMES = {
  light: "material-theme-lighter",
  dark: "material-theme-darker",
};

export const SHIKI_OPTIONS = {
  themes: SHIKI_THEMES,
  defaultColor: false,
};
