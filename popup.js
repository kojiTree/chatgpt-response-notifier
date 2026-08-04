const enabledElement = document.querySelector('#enabled');
const soundEnabledElement = document.querySelector('#sound-enabled');
const tabMarkerEnabledElement = document.querySelector('#tab-marker-enabled');
const soundVolumeElement = document.querySelector('#sound-volume');
const soundVolumeValueElement = document.querySelector('#sound-volume-value');
const permissionElement = document.querySelector('#permission');
const monitoredTabsElement = document.querySelector('#monitored-tabs');
const lastEventElement = document.querySelector('#last-event');
const lastEventDetailsElement = document.querySelector('#last-event-details');
const resultElement = document.querySelector('#details');
const testSoundButton = document.querySelector('#test-sound-button');
const testButton = document.querySelector('#test-button');
const refreshButton = document.querySelector('#refresh-button');

const CHATGPT_URLS = ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
const DEFAULT_SOUND_VOLUME = 0.7;

function runtimeError() {
  return chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
}

function clampVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return DEFAULT_SOUND_VOLUME;
  return Math.min(1, Math.max(0, volume));
}

function updateVolumeUi() {
  const volume = Math.round(clampVolume(Number(soundVolumeElement.value) / 100) * 100);
  soundVolumeValueElement.value = `${volume}%`;
  soundVolumeElement.disabled = !soundEnabledElement.checked;
  soundVolumeElement.closest('.volume-row')?.classList.toggle('disabled', !soundEnabledElement.checked);
}

function formatTime(timestamp) {
  if (!timestamp) return 'Unknown time';
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function readPermissionLevel() {
  chrome.notifications.getPermissionLevel((level) => {
    const error = runtimeError();
    permissionElement.textContent = error ? 'Error' : level;
    if (error) resultElement.textContent = `Permission check failed: ${error}`;
  });
}

function readSettingsAndLastEvent() {
  chrome.storage.local.get({
    enabled: true,
    soundEnabled: true,
    soundVolume: DEFAULT_SOUND_VOLUME,
    tabMarkerEnabled: true,
    lastEvent: null
  }, (values) => {
    const error = runtimeError();
    if (error) {
      resultElement.textContent = `Storage read failed: ${error}`;
      return;
    }

    enabledElement.checked = values.enabled !== false;
    soundEnabledElement.checked = values.soundEnabled !== false;
    tabMarkerEnabledElement.checked = values.tabMarkerEnabled !== false;
    soundVolumeElement.value = String(Math.round(clampVolume(values.soundVolume) * 100));
    updateVolumeUi();

    const event = values.lastEvent;
    if (!event) {
      lastEventElement.textContent = 'None yet';
      lastEventDetailsElement.textContent = 'Send a new ChatGPT message to test detection.';
      return;
    }

    lastEventElement.textContent =
      event.type === 'action_required' ? 'Action required' : 'Response completed';
    lastEventDetailsElement.textContent = `${formatTime(event.timestamp)} · ${event.pageTitle || 'ChatGPT'}`;
  });
}

function pingTab(tab) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: 'CHATGPT_NOTIFIER_PING' }, (response) => {
      const error = runtimeError();
      resolve({
        tab,
        connected: !error && Boolean(response?.ok),
        error,
        response
      });
    });
  });
}

function ensureMonitors() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ENSURE_MONITORS' }, (response) => {
      const error = runtimeError();
      resolve(error ? { ok: false, error } : response || { ok: false, error: 'No response' });
    });
  });
}

function describeTab(item, index) {
  const title = item.tab.title || `ChatGPT tab ${index + 1}`;
  if (!item.connected) {
    return `${index + 1}. ${title}\n   disconnected · ${item.error || 'no monitor response'}`;
  }

  const response = item.response || {};
  const state = response.state || {};
  const snapshot = response.lastSnapshot || {};
  return [
    `${index + 1}. ${title}`,
    `   v${response.version || '?'} · assistant/user ${snapshot.assistantCount ?? '?'}/${snapshot.userCount ?? '?'}`,
    `   send ${snapshot.sendVisible ? 'yes' : 'no'} · stop ${snapshot.stopVisible ? 'yes' : 'no'} · awaiting ${state.awaitingResponse ? 'yes' : 'no'} · generating ${state.generating ? 'yes' : 'no'}`,
    `   last scan: ${response.lastScanReason || 'unknown'}`
  ].join('\n');
}

async function refreshTabStatus() {
  refreshButton.disabled = true;
  monitoredTabsElement.textContent = 'Checking…';

  const injection = await ensureMonitors();

  chrome.tabs.query({ url: CHATGPT_URLS }, async (tabs) => {
    const queryError = runtimeError();
    if (queryError) {
      monitoredTabsElement.textContent = 'Error';
      resultElement.textContent = `Could not list ChatGPT tabs: ${queryError}`;
      refreshButton.disabled = false;
      return;
    }

    const results = await Promise.all(tabs.map(pingTab));
    const connected = results.filter((item) => item.connected);
    monitoredTabsElement.textContent = `${connected.length}/${tabs.length} connected`;

    if (tabs.length === 0) {
      resultElement.textContent = 'No open ChatGPT tabs. Open chatgpt.com, then refresh status.';
    } else {
      const summary = connected.length === tabs.length
        ? `Monitoring all ${connected.length} ChatGPT tab${connected.length === 1 ? '' : 's'}.`
        : `${connected.length} of ${tabs.length} ChatGPT tabs are connected.`;
      const injectionLine = injection?.ok
        ? `Monitor injection: ${injection.injectedTabs}/${injection.totalTabs} tabs.`
        : `Monitor injection failed: ${injection?.error || 'Unknown error'}`;
      resultElement.textContent = [
        summary,
        injectionLine,
        '',
        ...results.map(describeTab)
      ].join('\n');
    }

    refreshButton.disabled = false;
  });
}

function sendTestNotification() {
  testButton.disabled = true;
  resultElement.textContent = 'Sending a diagnostic notification…';

  chrome.runtime.sendMessage({ type: 'TEST_NOTIFICATION' }, (response) => {
    testButton.disabled = false;
    const error = runtimeError();
    if (error) {
      resultElement.textContent = `Service worker message failed: ${error}`;
      return;
    }
    if (!response?.ok) {
      resultElement.textContent = `Notification failed: ${response?.error || 'Unknown error'}`;
      return;
    }
    permissionElement.textContent = response.permissionLevel;
    resultElement.textContent = [
      'Test notification created by Chrome.',
      `ID: ${response.notificationId}`,
      `Registered: ${response.registeredByChrome}`
    ].join('\n');
  });
}

function sendTestSound() {
  testSoundButton.disabled = true;
  resultElement.textContent = 'Playing the packaged chime…';

  chrome.runtime.sendMessage({ type: 'TEST_SOUND' }, (response) => {
    testSoundButton.disabled = false;
    const error = runtimeError();
    if (error) {
      resultElement.textContent = `Sound message failed: ${error}`;
      return;
    }
    if (!response?.ok) {
      resultElement.textContent = `Sound failed: ${response?.error || 'Unknown error'}`;
      return;
    }
    resultElement.textContent = `Packaged chime played at ${Math.round(response.volume * 100)}% volume.`;
  });
}

enabledElement.addEventListener('change', () => {
  chrome.storage.local.set({ enabled: enabledElement.checked }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save setting: ${error}`
      : enabledElement.checked
        ? 'Desktop notifications enabled.'
        : 'Desktop notifications disabled; tab markers and chimes keep their own settings.';
  });
});


tabMarkerEnabledElement.addEventListener('change', () => {
  chrome.storage.local.set({ tabMarkerEnabled: tabMarkerEnabledElement.checked }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save tab marker setting: ${error}`
      : tabMarkerEnabledElement.checked
        ? 'Finished ChatGPT tabs will be highlighted until opened.'
        : 'Tab highlighting disabled.';
  });
});

soundEnabledElement.addEventListener('change', () => {
  updateVolumeUi();
  chrome.storage.local.set({ soundEnabled: soundEnabledElement.checked }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save sound setting: ${error}`
      : soundEnabledElement.checked
        ? 'Custom chime enabled.'
        : 'Custom chime disabled; normal system notification sound may still play.';
  });
});

soundVolumeElement.addEventListener('input', updateVolumeUi);
soundVolumeElement.addEventListener('change', () => {
  const soundVolume = clampVolume(Number(soundVolumeElement.value) / 100);
  chrome.storage.local.set({ soundVolume }, () => {
    const error = runtimeError();
    resultElement.textContent = error
      ? `Could not save volume: ${error}`
      : `Chime volume set to ${Math.round(soundVolume * 100)}%.`;
  });
});

testSoundButton.addEventListener('click', sendTestSound);
testButton.addEventListener('click', sendTestNotification);
refreshButton.addEventListener('click', () => {
  readPermissionLevel();
  readSettingsAndLastEvent();
  refreshTabStatus();
});

readPermissionLevel();
readSettingsAndLastEvent();
refreshTabStatus();
