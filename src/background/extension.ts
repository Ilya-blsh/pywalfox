import {
  IPalette,
  IPywalColors,
  IColorscheme,
  IBrowserTheme,
  IThemeTemplate,
  IOptionSetData,
  IExtensionTheme,
  IPaletteTemplate,
  IExtensionMessage,
  IExtensionOptions,
  ITimeIntervalEndpoint,
  ThemeModes,
  CSSTargets,
} from '../definitions';

import {
  extendPywalColors,
  generateColorscheme,
  generateBrowserTheme,
} from './colorscheme';

import {
  EXTENSION_PAGES,
  EXTENSION_OPTIONS,
  EXTENSION_MESSAGES,
  DEFAULT_CSS_FONT_SIZE,
  MIN_REQUIRED_DAEMON_VERSION,
} from '../config/general';

import {
  DEFAULT_THEME_DARK,
  DEFAULT_THEME_LIGHT,
} from '../config/default-themes';

import { State } from './state';
import { NativeApp } from './native-app';
import { isDayTime } from '../utils/time';
import { ExtensionPage } from './extension-page';

import * as UI from '../communication/ui';
import * as DDG from '../communication/duckduckgo';

export class Extension {
  private state: State;
  private nativeApp: NativeApp;
  private settingsPage: ExtensionPage;
  private updatePage: ExtensionPage;

  constructor() {
    this.state = new State();
    this.nativeApp = new NativeApp({
      connected: this.nativeAppConnected.bind(this),
      updateNeeded: this.updateNeeded.bind(this),
      disconnected: this.nativeAppDisconnected.bind(this),
      version: this.validateVersion.bind(this),
      output: UI.sendDebuggingOutput,
      colorscheme: this.onPywalColorsReceived.bind(this),
      cssToggleSuccess: this.cssToggleSuccess.bind(this),
      cssToggleFailed: this.cssToggleFailed.bind(this),
      cssFontSizeSetSuccess: this.cssFontSizeSetSuccess.bind(this),
      cssFontSizeSetFailed: this.cssFontSizeSetFailed.bind(this),
    });

    browser.runtime.onMessage.addListener(this.onMessage.bind(this));
    browser.browserAction.onClicked.addListener(() => this.settingsPage.open());
  }

  private getDefaultTemplate() {
    const themeMode = this.state.getThemeMode();

    if (!themeMode) {
      console.error('Theme mode is not set');
      return;
    }

    if (themeMode === ThemeModes.Dark) {
      return DEFAULT_THEME_DARK;
    }

    return DEFAULT_THEME_LIGHT;
  }

  private setOption(optionData: IOptionSetData) {
    if (!optionData) {
      UI.sendDebuggingOutput('Tried to set option, but no data was provided', true);
      return;
    }

    switch (optionData.option) {
      case EXTENSION_OPTIONS.FONT_SIZE:
        this.setCssFontSize(optionData);
        break;
      case EXTENSION_OPTIONS.DUCKDUCKGO:
        this.setDDGEnabled(optionData);
        break;
      case EXTENSION_OPTIONS.USER_CHROME: /* Fallthrough */
      case EXTENSION_OPTIONS.USER_CONTENT:
        this.setCustomCSSEnabled(optionData);
        break;
      case EXTENSION_OPTIONS.AUTO_TIME_START: /* Fallthrough */
      case EXTENSION_OPTIONS.AUTO_TIME_END:
        this.setAutoTimeInterval(optionData);
        break;
      default:
        UI.sendDebuggingOutput(`Received unhandled option: ${optionData.option}`);
    }
  }

  /* Handles incoming messages from the UI and other content scripts. */
  private onMessage({ action, data }: IExtensionMessage) {
    switch (action) {
      case EXTENSION_MESSAGES.INITIAL_DATA_GET:
        UI.sendInitialData(this.state.getInitialData());
        break;
      case EXTENSION_MESSAGES.DDG_THEME_GET:
        this.setDDGTheme();
        break;
      case EXTENSION_MESSAGES.PALETTE_TEMPLATE_SET:
        this.setPaletteTemplate(data);
        break;
      case EXTENSION_MESSAGES.THEME_TEMPLATE_SET:
        this.setThemeTemplate(data);
        break;
      case EXTENSION_MESSAGES.THEME_MODE_SET:
        this.setThemeMode(data);
        break;
      case EXTENSION_MESSAGES.THEME_FETCH:
        this.nativeApp.requestColorscheme();
        break;
      case EXTENSION_MESSAGES.THEME_DISABLE:
        this.resetThemes();
        break;
      case EXTENSION_MESSAGES.PALETTE_COLOR_SET:
        this.setPaletteColor(data);
        break;
      case EXTENSION_MESSAGES.OPTION_SET:
        this.setOption(data);
        break;
      case EXTENSION_MESSAGES.UPDATE_PAGE_MUTE:
        this.state.setUpdateMuted(true);
        this.updatePage.close();
        break;
    }
  }

  private updateExtensionPagesTheme(extensionTheme: IExtensionTheme) {
    this.settingsPage.setTheme(extensionTheme);
    this.updatePage.setTheme(extensionTheme);
  }

  private resetThemes() {
    browser.theme.reset();
    this.updateExtensionPagesTheme(null);

    if (this.state.getDDGThemeEnabled()) {
      DDG.resetTheme();
    }

    this.state.setColors(null, null);
    this.state.setCustomColors(null);
    this.state.setApplied(false);

    UI.sendDebuggingOutput('Theme was disabled');
  }

  private updateThemes(pywalColors: IPywalColors, customColors?: Partial<IPalette>) {
    const template = this.state.getTemplate();
    const colorscheme = generateColorscheme(pywalColors, customColors, template);

    this.setBrowserTheme(colorscheme.browser);
    this.updateExtensionPagesTheme(colorscheme.extension);

    if (this.state.getDDGThemeEnabled()) {
      DDG.setTheme(colorscheme.hash, colorscheme.duckduckgo);
    }

    this.state.setColors(pywalColors, colorscheme);
    this.state.setCustomColors(customColors ? customColors : null);
    this.state.setApplied(true);
  }

  private applyUpdatedPaletteTemplate(template: IPaletteTemplate) {
    const pywalColors = this.state.getPywalColors();
    const customColors = this.state.getCustomColors();

    if (!pywalColors) {
      return;
    }

    for (const color in customColors) {
      if (pywalColors[template[color]] === customColors[color]) {
        delete customColors[color];
      }
    }

    this.updateThemes(pywalColors, customColors);
    UI.sendCustomColors(customColors);
  }

  private applyDuckDuckGoTheme() {
    const colorscheme = this.state.getColorscheme();
    if (colorscheme) {
      DDG.setTheme(colorscheme.hash, colorscheme.duckduckgo);
    }
  }

  private setBrowserTheme(browserTheme: IBrowserTheme) {
    browser.theme.update({ colors: browserTheme });
  }

  private setDDGEnabled({ option, enabled }: IOptionSetData) {
    const isEnabled = this.state.getDDGThemeEnabled();

    if (enabled && !isEnabled) {
      this.applyDuckDuckGoTheme();
    } else if (!enabled && isEnabled) {
      DDG.resetTheme();
    }

    UI.sendOption(option, enabled);
    this.state.setDDGThemeEnabled(enabled);
  }

  private setDDGTheme() {
    const isEnabled = this.state.getDDGThemeEnabled();

    if (isEnabled) {
      this.applyDuckDuckGoTheme();
    } else {
      DDG.resetTheme();
    }
  }

  private setCustomCSSEnabled({ option, enabled }: IOptionSetData) {
    if (Object.values(CSSTargets).includes(<CSSTargets>option)) {
      this.nativeApp.requestCssEnabled(option, enabled);
    } else {
      let action = enabled ? 'enable' : 'disable';
      UI.sendNotification('Custom CSS', `Could not ${action} CSS target "${option}". Invalid target`, true);
      UI.sendOption(option, !enabled);
    }
  }

  private setCssFontSize({ value }: IOptionSetData) {
    if (value !== undefined && value >= 10 && value <= 20) {
      // Currently, only userChrome uses the custom font size feature
      this.nativeApp.requestFontSizeSet(CSSTargets.UserChrome, value);
    } else {
      UI.sendNotification('Font size error', 'Invalid size or not set', true);
    }
  }

  /**
   * Fetches the browser- and extension theme from state and applies it, if set.
   * This is used when launching the background script to increase the speed
   * at which the theme is applied.
   *
   * In all other cases, use 'updateThemes'.
   */
  private setSavedColorscheme(colorscheme: IColorscheme) {
    console.log('Applying saved colorscheme');
    this.setBrowserTheme(colorscheme.browser);
    this.updateExtensionPagesTheme(colorscheme.extension);
    this.state.setApplied(true);
  }

  private async onThemeChangeTrigger(isDay: boolean) {
    console.log(`Theme update triggered by automatic theme mode. Is day: ${isDay}`);
    await this.state.setIsDay(isDay);
    this.setThemeMode(this.state.getThemeMode());
  }

  private async setThemeMode(mode: ThemeModes) {
    await this.state.setThemeMode(mode); // Must wait for this to finish

    const pywalColors = this.state.getPywalColors();
    const template = this.state.getTemplate();
    const customColors = this.state.getCustomColors();
    pywalColors && this.updateThemes(pywalColors, customColors);

    if (mode === ThemeModes.Auto) {
      UI.sendThemeMode(this.state.getTemplateThemeMode(), false);
    }

    UI.sendPaletteTemplate(template.palette);
    UI.sendThemeTemplate(template.browser);
    UI.sendCustomColors(customColors);
  }

  private setPaletteTemplate(template: IPaletteTemplate) {
    let updatedTemplate: IPaletteTemplate = template;
    if (updatedTemplate === null) {
      updatedTemplate = this.getDefaultTemplate().palette;
    }

    this.state.setPaletteTemplate(updatedTemplate);
    this.applyUpdatedPaletteTemplate(updatedTemplate);
    UI.sendPaletteTemplate(updatedTemplate);
    UI.sendNotification('Palette template', 'Template was updated successfully');
  }

  private setThemeTemplate(template: IThemeTemplate) {
    const palette = this.state.getPalette();
    let updatedTemplate = template;

    if (updatedTemplate === null) {
      updatedTemplate = this.getDefaultTemplate().browser;
    }

    if (palette !== null) {
      // Generate a new browser theme only based on the current palette and the new template
      const browserTheme = generateBrowserTheme(palette, updatedTemplate);
      this.setBrowserTheme(browserTheme);
      this.state.setBrowserTheme(browserTheme);
    }

    this.state.setThemeTemplate(updatedTemplate);
    UI.sendThemeTemplate(updatedTemplate);
    UI.sendNotification('Theme template', 'Template was updated successfully');
  }

  private setPaletteColor(palette: Partial<IPalette>) {
    const pywalColors = this.state.getPywalColors();
    if (pywalColors !== null) {
      const customPalette = this.createCustomColorPalette(palette);
      this.updateThemes(pywalColors, customPalette);
    }
  }

  private setAutoTimeInterval({ option, value }: IOptionSetData) {
    // TODO: Update the auto mode check timeout to use the new interval
    if (option === EXTENSION_OPTIONS.AUTO_TIME_START) {
      this.state.setAutoTimeStart(value);
      UI.sendAutoTimeStart(value);
    } else {
      this.state.setAutoTimeEnd(value);
      UI.sendAutoTimeEnd(value);
    }

    UI.sendNotification('Auto mode', 'Light theme time interval was updated successfully');
  }

  private createCustomColorPalette(data: Partial<IPalette>) {
    const currentColors = this.state.getCustomColors();

    if (currentColors === null) {
      return data;
    }

    return Object.assign(currentColors, data);
  }

  private validateVersion(version: string) {
    const versionNumber = parseFloat(version);
    if (versionNumber < MIN_REQUIRED_DAEMON_VERSION) {
      this.updateNeeded();
    }

    this.state.setVersion(versionNumber);
  }

  private updateNeeded() {
    if (this.state.getUpdateMuted()) {
      console.log('Update is required, but user has muted update notifications');
      return;
    }

    this.updatePage.open();
  }

  private nativeAppConnected() {
    this.state.setConnected(true);
  }

  private nativeAppDisconnected() {
    UI.sendDebuggingOutput('Disconnected from native app', true);
    UI.sendDebuggingInfo({ connected: false, version: this.state.getVersion() });
    this.state.setConnected(false);
  }

  private onPywalColorsReceived(pywalColors: IPywalColors) {
    const colors = extendPywalColors(pywalColors);
    UI.sendDebuggingOutput('Pywal colors was fetched from daemon and applied successfully');
    UI.sendPywalColors(colors);
    this.updateThemes(colors);
  }

  private cssToggleSuccess(target: CSSTargets) {
    const newState = this.state.getCssEnabled(target) ? false : true;
    let notificationMessage: string = `${target} was disabled successfully!`;

    if (newState === true) {
      notificationMessage = `${target} was enabled successfully!`;

      // If the user has changed the default font size, we must update it after
      // the CSS has been enabled.
      if (target === CSSTargets.UserChrome) {
        const fontSize = this.state.getCssFontSize();
        if (fontSize !== DEFAULT_CSS_FONT_SIZE) {
          this.setCssFontSize(fontSize);
        }
      }
    }

    UI.sendOption(target, newState);
    UI.sendNotification('Restart needed', notificationMessage);
    this.state.setCssEnabled(target, newState);
  }

  private cssToggleFailed(target: string, error: string) {
    const currentState = this.state.getCssEnabled(target);
    UI.sendOption(target, currentState);
    UI.sendNotification('Custom CSS', error);
  }

  private cssFontSizeSetSuccess(size: number) {
    UI.sendNotification('Restart needed', 'Updated base font size successfully');
    UI.sendFontSize(size);
    this.state.setCssFontSize(size);
  }

  private cssFontSizeSetFailed(error: string) {
    UI.sendNotification('Font size', error, false);
  }

  public async start() {
    await this.state.load();
    this.settingsPage = new ExtensionPage(EXTENSION_PAGES.SETTINGS);
    this.updatePage = new ExtensionPage(EXTENSION_PAGES.UPDATE);

    // Run this after creating the extension pages so that the themes can be
    // set if the pages were reopened on launch.
    const savedColorscheme = this.state.getColorscheme();
    if (savedColorscheme !== null) {
      this.setSavedColorscheme(savedColorscheme);
    }

    this.nativeApp.connect();
  }
}
