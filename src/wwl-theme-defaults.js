/**
 * Labs global theme defaults for `@vanduo-oss/vd3`.
 *
 * Passed as `themeDefaults` to `VanduoVue`. vd3 falls back to these when the
 * corresponding `wwl-*` localStorage key is unset (`storagePrefix: 'wwl-'`).
 * Existing stored preferences are never overwritten by these defaults.
 *
 * `THEME: 'system'` means first-time visitors follow the OS. Visual styling
 * still resolves to only light or dark via `installResolvedTheme` / vd3
 * `applyPreference` — never a third `data-theme` path.
 */
export const WWL_THEME_DEFAULTS = Object.freeze({
  PALETTE: 'open-color',
  PRIMARY_LIGHT: 'green',
  PRIMARY_DARK: 'green',
  NEUTRAL: 'neutral',
  RADIUS: '0.5',
  FONT: 'open-sans',
  THEME: 'system',
});
