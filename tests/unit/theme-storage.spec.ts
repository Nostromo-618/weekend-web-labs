import { test, expect } from '@playwright/test';

test.describe('vd3 storagePrefix (wwl-)', () => {
  test('Labs bootstrap uses storagePrefix wwl- (no remapper shim)', async ({ page }) => {
    await page.goto('/tests/fixtures/blank-harness.html');

    const result = await page.evaluate(async () => {
      const mainSrc = await (await fetch('/src/main.js')).text();

      // Simulate docs prefs that must remain untouched on a shared origin.
      localStorage.setItem('vanduo-theme-preference', 'light');
      localStorage.setItem('vanduo-palette', 'open-color');

      // Official prefix contract: keys are `${prefix}${suffix}`.
      const prefix = 'wwl-';
      localStorage.setItem(`${prefix}theme-preference`, 'dark');
      localStorage.setItem(`${prefix}palette`, 'fibonacci');
      localStorage.setItem(`${prefix}primary-color`, 'sky');

      return {
        mainUsesPrefix: /storagePrefix:\s*['"]wwl-['"]/.test(mainSrc),
        mainDropsRemapper: !/wwl-theme-storage/.test(mainSrc),
        theme: localStorage.getItem('wwl-theme-preference'),
        palette: localStorage.getItem('wwl-palette'),
        primary: localStorage.getItem('wwl-primary-color'),
        docsTheme: localStorage.getItem('vanduo-theme-preference'),
        docsPalette: localStorage.getItem('vanduo-palette'),
      };
    });

    expect(result.mainUsesPrefix).toBe(true);
    expect(result.mainDropsRemapper).toBe(true);
    expect(result.theme).toBe('dark');
    expect(result.palette).toBe('fibonacci');
    expect(result.primary).toBe('sky');
    expect(result.docsTheme).toBe('light');
    expect(result.docsPalette).toBe('open-color');
  });
});

test.describe('vdl theme defaults', () => {
  test('exports Labs global themeDefaults for unset wwl-* prefs', async ({ page }) => {
    await page.goto('/tests/fixtures/blank-harness.html');

    const defaults = await page.evaluate(async () => {
      const mod = await import('/src/wwl-theme-defaults.js');
      return mod.WWL_THEME_DEFAULTS;
    });

    expect(defaults.FONT).toBe('open-sans');
    expect(defaults.NEUTRAL).toBe('neutral');
    expect(defaults.RADIUS).toBe('0.5');
    expect(defaults.PALETTE).toBe('open-color');
    expect(defaults.PRIMARY_LIGHT).toBe('green');
    expect(defaults.PRIMARY_DARK).toBe('green');
    expect(defaults.THEME).toBe('system');
  });

  test('maps theme primary to VdDock surface tint tokens', async ({ page }) => {
    await page.goto('/tests/fixtures/blank-harness.html');

    const mapping = await page.evaluate(async () => {
      const mod = await import('/src/composables/useLabsDockTint.js');
      return {
        sky: mod.labsPrimaryToDockTint('sky'),
        yellow: mod.labsPrimaryToDockTint('yellow'),
        black: mod.labsPrimaryToDockTint('black'),
        purple: mod.labsPrimaryToDockTint('purple'),
      };
    });

    expect(mapping).toEqual({
      sky: 'blue',
      yellow: 'yellow',
      black: '',
      purple: 'violet',
    });
  });

  test('exports Labs primary fan swatch keys (Ink + 12 hues)', async ({ page }) => {
    await page.goto('/tests/fixtures/blank-harness.html');

    const keys = await page.evaluate(async () => {
      const mod = await import('/src/labs-primary-swatches.js');
      return mod.LABS_PRIMARY_SWATCH_KEYS;
    });

    expect(keys).toHaveLength(13);
    expect(keys[0]).toBe('black');
    expect(keys).toContain('sky');
    expect(keys).not.toContain('gray');
  });
});

test.describe('resolved theme (system → light|dark)', () => {
  test('resolveThemeScheme maps system via prefers-color-scheme', async ({ page }) => {
    await page.goto('/tests/fixtures/blank-harness.html');

    const light = await page.evaluate(async () => {
      const mod = await import('/src/wwl-resolved-theme.js');
      return mod.resolveThemeScheme('system');
    });
    // harness has no forced scheme — either light or dark is fine as long as resolved
    expect(['light', 'dark']).toContain(light);

    await page.emulateMedia({ colorScheme: 'dark' });
    expect(
      await page.evaluate(async () => {
        const mod = await import('/src/wwl-resolved-theme.js');
        return mod.resolveThemeScheme('system');
      }),
    ).toBe('dark');

    await page.emulateMedia({ colorScheme: 'light' });
    expect(
      await page.evaluate(async () => {
        const mod = await import('/src/wwl-resolved-theme.js');
        return mod.resolveThemeScheme('system');
      }),
    ).toBe('light');

    expect(
      await page.evaluate(async () => {
        const mod = await import('/src/wwl-resolved-theme.js');
        return {
          light: mod.resolveThemeScheme('light'),
          dark: mod.resolveThemeScheme('dark'),
        };
      }),
    ).toEqual({ light: 'light', dark: 'dark' });
  });

  test('installResolvedTheme keeps data-theme as light|dark when preference is system', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem('wwl-theme-preference', 'system');
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const boot = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      colorScheme:
        document.documentElement.style.colorScheme ||
        document.documentElement.style.getPropertyValue('color-scheme'),
      pref: localStorage.getItem('wwl-theme-preference'),
    }));
    expect(boot.pref).toBe('system');
    expect(boot.theme).toBe('dark');
    expect(boot.theme).not.toBe('system');
    expect(boot.colorScheme).toBe('dark');

    // Simulate legacy vd3 clearing data-theme for system — Labs must restore.
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-theme');
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('explicit light/dark preferences stamp matching data-theme', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('wwl-theme-preference', 'light');
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.evaluate(() => {
      localStorage.setItem('wwl-theme-preference', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.documentElement.style.setProperty('color-scheme', 'dark');
    });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
