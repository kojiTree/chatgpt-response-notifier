function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(tabs || []);
    });
  });
}

function executeContentScripts(tabId) {
  return new Promise((resolve) => {
    if (!chrome.scripting?.executeScript) {
      resolve({ tabId, ok: false, error: 'chrome.scripting is unavailable.' });
      return;
    }

    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: CONTENT_SCRIPT_FILES
      },
      () => {
        const error = runtimeError();
        resolve(error ? { tabId, ok: false, error: error.message } : { tabId, ok: true });
      }
    );
  });
}

async function ensureMonitors() {
  const tabs = await tabsQuery({ url: CHATGPT_URLS });
  const validTabs = tabs.filter((tab) => Number.isInteger(tab.id));
  const results = await Promise.all(validTabs.map((tab) => executeContentScripts(tab.id)));
  return {
    ok: true,
    totalTabs: validTabs.length,
    injectedTabs: results.filter((result) => result.ok).length,
    failures: results.filter((result) => !result.ok)
  };
}

function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(tab);
    });
  });
}

function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, (tab) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(tab);
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    if (!chrome.tabs?.sendMessage) {
      resolve(null);
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = runtimeError();
      if (error) reject(error);
      else resolve(response || null);
    });
  });
}

async function markSourceTab(tabId, eventType) {
  if (!chrome.tabs?.sendMessage) return { ok: false, skipped: 'unavailable' };
  try {
    const response = await tabsSendMessage(tabId, { type: MARK_TAB, eventType });
    return response?.ok
      ? { ok: true, marked: response.marked !== false }
      : { ok: false, error: response?.error || 'Tab marker did not respond.' };
  } catch (error) {
    console.warn('Could not mark ChatGPT tab:', error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function clearTabMarker(tabId) {
  if (!Number.isInteger(tabId) || !chrome.tabs?.sendMessage) return { ok: false, skipped: 'unavailable' };
  try {
    const response = await tabsSendMessage(tabId, { type: CLEAR_TAB_MARKER });
    return response?.ok
      ? { ok: true, cleared: response.cleared !== false }
      : { ok: false, error: response?.error || 'Tab marker did not respond.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

