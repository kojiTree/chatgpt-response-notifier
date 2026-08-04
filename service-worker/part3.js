function windowsGet(windowId) {
  return new Promise((resolve, reject) => {
    if (!chrome.windows?.get) {
      resolve(null);
      return;
    }

    chrome.windows.get(windowId, (windowInfo) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(windowInfo || null);
    });
  });
}

function windowsUpdate(windowId, updateInfo) {
  return new Promise((resolve, reject) => {
    chrome.windows.update(windowId, updateInfo, () => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve();
    });
  });
}

async function isSourceTabVisible(tabId) {
  try {
    const tab = await tabsGet(tabId);
    if (!tab?.active || !Number.isInteger(tab.windowId)) return false;

    const windowInfo = await windowsGet(tab.windowId);
    return windowInfo?.focused === true;
  } catch (error) {
    console.warn('Could not determine whether the ChatGPT tab is visible; notifying instead:', error);
    return false;
  }
}

function truncate(text, maxLength = 220) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Your ChatGPT response is ready.';
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function notificationTitle(eventType, pageTitle, maxLength = 100) {
  const status = eventType === 'action_required' ? 'Action needed' : 'Response ready';
  const normalizedPageTitle = String(pageTitle || '').replace(/\s+/g, ' ').trim();
  if (!normalizedPageTitle || normalizedPageTitle.toLowerCase() === 'chatgpt') {
    return `ChatGPT · ${status}`;
  }

  const available = Math.max(1, maxLength - status.length - 3);
  return `${status} · ${truncate(normalizedPageTitle, available)}`;
}

async function runNotificationTest() {
  const permissionLevel = await getPermissionLevel();
  if (permissionLevel !== 'granted') {
    return {
      ok: false,
      stage: 'permission',
      permissionLevel,
      error: `Chrome notification permission is ${permissionLevel}.`
    };
  }

  const notificationId = `chatgpt:test:0:${Date.now()}`;
  const createdId = await createNotification(notificationId, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'ChatGPT Notifier test',
    message: 'The Chrome extension notification pipeline works.',
    contextMessage: 'Diagnostic test',
    priority: 2,
    requireInteraction: false,
    silent: false
  });
  scheduleNotificationClear(createdId);

  const activeNotifications = await getActiveNotifications();
  return {
    ok: true,
    stage: 'created',
    permissionLevel,
    notificationId: createdId,
    registeredByChrome: Object.prototype.hasOwnProperty.call(activeNotifications, createdId)
  };
}

