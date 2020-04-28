import { Dialog } from './dialog';
import * as Messenger from './messenger';
import { Colorpicker } from './colorpicker';
import { Themepicker } from './themepicker';
import { toggleOpen, open, close, isOpen } from './utils';
import { IExtensionMessage, IColorschemeTemplate } from '../definitions';
import { EXTENSION_MESSAGES } from '../config';

const fetchButton: HTMLElement = document.getElementById('fetch');
const disableButton: HTMLElement = document.getElementById('disable');
const themeButton: HTMLElement = document.getElementById('theme-select');
const colorButtons: NodeListOf<HTMLElement> = document.querySelectorAll('button[data-color]');
const settingCardHeaders: NodeListOf<HTMLElement> = document.querySelectorAll('.setting-card-header');
const debuggingOutput: HTMLTextAreaElement = <HTMLTextAreaElement>document.getElementById('debugging-output');
const debuggingConnected: HTMLElement = document.getElementById('debugging-connected');
const debuggingVersion: HTMLElement = document.getElementById('debugging-version');
const overlay: HTMLElement = document.getElementById('overlay');

const colorpicker = new Colorpicker();
const themepicker = new Themepicker();
let currentDialog: Dialog = null;
let template: IColorschemeTemplate = null;

/**
 * Opens a dialog on the right hand side of the UI.
 *
 * @param {IDialog} dialog - the dialog to open
 * @param {HTMLElement} target - the element that triggered the opening of the dialog
 */
function openDialog(dialog: Dialog, target: HTMLElement) {
  const overlayOpen = isOpen(overlay);

  if (!overlayOpen) {
    open(overlay);
  }

  if (currentDialog === dialog) {
    if (dialog !== colorpicker || currentDialog.getTarget() === target) {
      closeDialog();
      return;
    }
  } else if (currentDialog !== null && currentDialog !== dialog) {
    currentDialog.close();
  }

  dialog.open(target);
  currentDialog = dialog;
}

function closeDialog() {
  if (currentDialog !== null) {
    currentDialog.close();
    currentDialog = null;
  }

  if (isOpen(overlay)) {
    close(overlay);
  }
}

function setDebuggingInfo(info: { connected: boolean, version: number }) {
  debuggingConnected.innerText = info.connected ? 'Connected' : 'Disconnected';
  debuggingVersion.innerText = `version ${info.version}`;
}

function writeOutput(message: string) {
  debuggingOutput.value += message + '\n';
  debuggingOutput.scrollTop = debuggingOutput.scrollHeight; // Scrolls to bottom of textarea
}

function onSettingCardClicked(header: HTMLElement) {
  toggleOpen(<HTMLElement>header.parentNode);
}

function onColorClicked(e: Event) {
  const element = <HTMLElement>e.target;
  openDialog(colorpicker, element);
  colorpicker.setSelectedColorForTarget(template);
}

function onOverlayClicked(e: Event) {
  closeDialog();
}

function onFetchClicked(e: Event) {
  Messenger.requestFetch();
}

function onDisableClicked(e: Event) {
  Messenger.requestDisable();
  colorpicker.setPalette(null);
  colorpicker.setSelectedColorForTarget(null);
}

function onThemeClicked(e: Event) {
  openDialog(themepicker, themeButton);
}

fetchButton.addEventListener('click', onFetchClicked);
disableButton.addEventListener('click', onDisableClicked);
themeButton.addEventListener('click', onThemeClicked);
colorButtons.forEach((button: HTMLElement) => button.addEventListener('click', onColorClicked));
settingCardHeaders.forEach((header: HTMLElement) => header.addEventListener('click', () => onSettingCardClicked(header)));
overlay.addEventListener('click', onOverlayClicked);

browser.runtime.onMessage.addListener((message: IExtensionMessage) => {
  switch (message.action) {
    case EXTENSION_MESSAGES.PYWAL_COLORS_SET:
      colorpicker.setPalette(message.data);
      break;
    case EXTENSION_MESSAGES.TEMPLATE_SET:
      template = message.data;
      colorpicker.setSelectedColorForTarget(template);
      break;
    case EXTENSION_MESSAGES.THEME_MODE_SET:
      themepicker.setSelectedMode(message.data);
      break;
    case EXTENSION_MESSAGES.DEBUGGING_OUTPUT:
      writeOutput(message.data);
      break;
    case EXTENSION_MESSAGES.DEBUGGING_INFO_SET:
      setDebuggingInfo(message.data);
      break;
  }
});

// TODO: Combine into one call
Messenger.requestPywalColors();
Messenger.requestTemplate();
Messenger.requestThemeMode();
Messenger.requestDebuggingInfo();
