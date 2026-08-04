const TEST_NOTIFICATION = 'TEST_NOTIFICATION';
const TEST_SOUND = 'TEST_SOUND';
const PLAY_SOUND = 'PLAY_SOUND';
const CHATGPT_EVENT = 'CHATGPT_EVENT';
const ENSURE_MONITORS = 'ENSURE_MONITORS';
const MARK_TAB = 'CHATGPT_NOTIFIER_MARK_TAB';
const CLEAR_TAB_MARKER = 'CHATGPT_NOTIFIER_CLEAR_TAB_MARKER';
const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const OFFSCREEN_URL = 'offscreen.html';
const DEFAULT_SOUND_VOLUME = 0.7;
const NOTIFICATION_LIFETIME_MS = 10_000;
let creatingOffscreenDocument = null;
const notificationClearTimers = new Map();

const CONTENT_SCRIPT_FILES = [
  'detector-core.js',
  'page-utils.js',
  'dom-adapter.js',
  'tab-marker.js',
  'content-script.js'
];

function runtimeError() {
  return chrome.runtime.lastError ? new Error(chrome.runtime.lastError.message) : null;
}

function getPermissionLevel() {
  return new Promise((resolve, reject) => {
    chrome.notifications.getPermissionLevel((level) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(level);
    });
  });
}

function createNotification(id, options) {
  return new Promise((resolve, reject) => {
    chrome.notifications.create(id, options, (createdId) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(createdId);
    });
  });
}

function getActiveNotifications() {
  return new Promise((resolve, reject) => {
    chrome.notifications.getAll((notifications) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(notifications);
    });
  });
}

function clearNotification(notificationId) {
  return new Promise((resolve, reject) => {
    chrome.notifications.clear(notificationId, (wasCleared) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(wasCleared);
    });
  });
}

function cancelNotificationClear(notificationId) {
  const timerId = notificationClearTimers.get(notificationId);
  if (timerId === undefined) return;

  if (typeof clearTimeout === 'function') clearTimeout(timerId);
  notificationClearTimers.delete(notificationId);
}

function scheduleNotificationClear(notificationId) {
  cancelNotificationClear(notificationId);
  if (typeof setTimeout !== 'function') return;

  const timerId = setTimeout(() => {
    notificationClearTimers.delete(notificationId);
    clearNotification(notificationId).catch((error) => {
      console.warn('Could not auto-clear notification:', error);
    });
  }, NOTIFICATION_LIFETIME_MS);
  notificationClearTimers.set(notificationId, timerId);
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (values) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(values);
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve();
    });
  });
}

function normalizeVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function ensureOffscreenDocument() {
  if (!chrome.runtime.getContexts || !chrome.runtime.getURL) {
    throw new Error('This Chrome version does not support offscreen audio contexts.');
  }
  if (!chrome.offscreen?.createDocument) {
    throw new Error('chrome.offscreen is unavailable.');
  }

  const documentUrl = chrome.runtime.getURL(OFFSCREEN_URL);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [documentUrl]
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification: 'Play an alert when a ChatGPT response finishes.'
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

async function playNotificationSound(volume) {
  await ensureOffscreenDocument();
  const normalizedVolume = normalizeVolume(volume);
  const response = await sendRuntimeMessage({
    target: 'offscreen',
    type: PLAY_SOUND,
    volume: normalizedVolume
  });
  if (!response?.ok) {
    throw new Error(response?.error || 'The offscreen audio player did not respond.');
  }
  return { ok: true, volume: normalizedVolume };
}

async function runSoundTest() {
  const settings = await storageGet({ soundVolume: DEFAULT_SOUND_VOLUME });
  return playNotificationSound(settings.soundVolume);
}


