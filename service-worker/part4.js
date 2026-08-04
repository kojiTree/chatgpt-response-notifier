async function handleChatGPTEvent(message, sender) {
  const settings = await storageGet(['enabled', 'soundEnabled', 'soundVolume', 'tabMarkerEnabled']);
  const notificationEnabled = settings.enabled !== false;
  const soundEnabled = settings.soundEnabled !== false;
  const markerEnabled = settings.tabMarkerEnabled !== false;

  if (!notificationEnabled && !soundEnabled && !markerEnabled) {
    return { ok: true, skipped: 'disabled' };
  }

  const event = message?.event;
  if (!event || !['response_complete', 'action_required'].includes(event.type)) {
    throw new Error('Unsupported ChatGPT event.');
  }

  const tabId = sender?.tab?.id;
  if (!Number.isInteger(tabId)) {
    throw new Error('ChatGPT event did not include a source tab.');
  }

  if (await isSourceTabVisible(tabId)) {
    return { ok: true, skipped: 'source_visible' };
  }

  const body = truncate(event.message);
  const pageTitle = truncate(message?.page?.title || sender.tab.title || 'ChatGPT', 80);
  const marker = markerEnabled
    ? await markSourceTab(tabId, event.type)
    : { ok: true, skipped: 'disabled' };

  let createdId = null;
  if (notificationEnabled) {
    const notificationId = `chatgpt:${event.type}:${tabId}:${Date.now()}`;
    const title = notificationTitle(event.type, pageTitle);
    createdId = await createNotification(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title,
      message: body,
      contextMessage: pageTitle,
      priority: 2,
      requireInteraction: false,
      silent: soundEnabled
    });
    scheduleNotificationClear(createdId);
  }

  const lastEvent = {
    type: event.type,
    message: body,
    tabId,
    pageTitle,
    url: message?.page?.url || sender.tab.url || '',
    timestamp: Date.now(),
    notificationId: createdId,
    markerApplied: marker.ok === true && marker.skipped !== 'disabled'
  };
  await storageSet({ lastEvent });

  let sound;
  if (!soundEnabled) {
    sound = { ok: true, skipped: 'disabled' };
  } else {
    try {
      sound = await playNotificationSound(settings.soundVolume);
    } catch (error) {
      sound = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
      console.error('Could not play ChatGPT notification sound:', error);
    }
  }

  return { ok: true, notificationId: createdId, lastEvent, sound, marker };
}

async function focusNotificationSource(notificationId) {
  cancelNotificationClear(notificationId);
  const match = /^chatgpt:[^:]+:(\d+):/.exec(notificationId);
  if (!match) return;

  const tabId = Number(match[1]);
  const tab = await tabsGet(tabId);
  await tabsUpdate(tabId, { active: true });
  if (Number.isInteger(tab.windowId)) {
    await windowsUpdate(tab.windowId, { focused: true });
  }
  await clearNotification(notificationId);
}

