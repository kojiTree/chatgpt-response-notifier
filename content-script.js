(function initContentScript(root, factory) {
  const detectorCore =
    typeof module === 'object' && module.exports
      ? require('./detector-core.js')
      : root.ChatGPTNotifierCore;
  const domAdapter =
    typeof module === 'object' && module.exports
      ? require('./dom-adapter.js')
      : root.ChatGPTNotifierDomAdapter;
  const tabMarkerModule =
    typeof module === 'object' && module.exports
      ? require('./tab-marker.js')
      : root.ChatGPTNotifierTabMarker;

  const api = factory(detectorCore, domAdapter, tabMarkerModule);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierContent = api;

  if (
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    !root.__chatgptNotifierMonitor
  ) {
    root.__chatgptNotifierMonitor = api.createMonitor({
      documentObject: document,
      windowObject: window,
      chromeObject: chrome,
      MutationObserverClass: MutationObserver
    });
    root.__chatgptNotifierMonitor.start();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function contentFactory(detectorCore, domAdapter, tabMarkerModule) {
  const { createDetector } = detectorCore;
  const { collectSnapshot, isComposerInput, isSendControl } = domAdapter;
  const { createTabMarker } = tabMarkerModule;

  function createMonitor({
    documentObject,
    windowObject,
    chromeObject,
    stableMs = 1400,
    fallbackStableMs = 4500,
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    MutationObserverClass,
    tabMarker = null
  }) {
    let detector = createDetector({ stableMs, fallbackStableMs });
    let currentUrl = windowObject.location.href;
    let observer = null;
    let immediateTimer = null;
    let settleTimer = null;
    let heartbeatTimer = null;
    let started = false;
    let lastSnapshot = null;
    let lastDispatch = null;
    let lastScanReason = 'not-started';
    let lastSubmissionAt = -Infinity;
    const resolvedTabMarker = tabMarker || createTabMarker({ documentObject, windowObject });

    function resetForRoute(url) {
      const submissionTimestamp = lastSubmissionAt;
      currentUrl = url;
      detector = createDetector({ stableMs, fallbackStableMs });
      if (now() - submissionTimestamp <= 10000) {
        detector.markUserSubmitted(submissionTimestamp);
      } else {
        lastSubmissionAt = -Infinity;
      }
      lastSnapshot = null;
      lastDispatch = null;
    }

    function sendEvent(event) {
      const payload = {
        type: 'CHATGPT_EVENT',
        event,
        page: {
          title: documentObject.title || 'ChatGPT',
          url: windowObject.location.href
        }
      };

      chromeObject.runtime.sendMessage(payload, (response) => {
        const error = chromeObject.runtime.lastError;
        if (error) {
          lastDispatch = { ok: false, error: error.message, event, timestamp: now() };
          return;
        }
        lastDispatch = {
          ok: Boolean(response?.ok),
          skipped: response?.skipped || null,
          error: response?.error || null,
          event,
          timestamp: now()
        };
      });
    }

    function scan(reason = 'manual') {
      const url = windowObject.location.href;
      if (url !== currentUrl) {
        resetForRoute(url);
        reason = `${reason}:route-reset`;
      }

      resolvedTabMarker.sync();
      const snapshot = collectSnapshot(documentObject, windowObject, now());
      const events = detector.scan(snapshot);
      lastSnapshot = snapshot;
      lastScanReason = reason;
      events.forEach(sendEvent);
      return events;
    }

    function scheduleScan(reason = 'mutation') {
      if (immediateTimer !== null) clearTimeoutFn(immediateTimer);
      if (settleTimer !== null) clearTimeoutFn(settleTimer);

      immediateTimer = setTimeoutFn(() => {
        immediateTimer = null;
        scan(reason);
      }, 80);

      settleTimer = setTimeoutFn(() => {
        settleTimer = null;
        scan(`${reason}:settled`);
      }, stableMs + 250);
    }

    function markSubmission(reason) {
      const timestamp = now();
      if (timestamp - lastSubmissionAt < 600) return;
      lastSubmissionAt = timestamp;
      detector.markUserSubmitted(timestamp);
      lastScanReason = `submission:${reason}`;
      scheduleScan(`submission:${reason}`);
    }

    function clickListener(event) {
      const control = event?.target?.closest?.('button,[role="button"]') || event?.target;
      if (isSendControl(control)) markSubmission('click');
    }

    function keydownListener(event) {
      if (
        event?.key === 'Enter' &&
        !event.shiftKey &&
        !event.isComposing &&
        isComposerInput(event.target)
      ) {
        markSubmission('enter');
      }
    }

    function submitListener(event) {
      const activeElement = documentObject.activeElement;
      const formHasComposer = Boolean(
        event?.target?.querySelector?.('textarea,[contenteditable="true"],[role="textbox"]')
      );
      if (formHasComposer || isComposerInput(activeElement)) {
        markSubmission('submit');
      }
    }

    function runtimeMessageListener(message, _sender, sendResponse) {
      if (message?.type === 'CHATGPT_NOTIFIER_MARK_TAB') {
        const marked = resolvedTabMarker.mark(message.eventType);
        sendResponse({ ok: true, marked, state: resolvedTabMarker.getState() });
        return false;
      }
      if (message?.type === 'CHATGPT_NOTIFIER_CLEAR_TAB_MARKER') {
        const cleared = resolvedTabMarker.clear();
        sendResponse({ ok: true, cleared, state: resolvedTabMarker.getState() });
        return false;
      }
      if (message?.type !== 'CHATGPT_NOTIFIER_PING') return false;
      sendResponse({
        ok: true,
        version: '0.8.0',
        url: windowObject.location.href,
        title: documentObject.title || 'ChatGPT',
        state: detector.getState(),
        tabMarker: resolvedTabMarker.getState(),
        lastSnapshot,
        lastDispatch,
        lastScanReason
      });
      return false;
    }

    function start() {
      if (started) return;
      started = true;
      chromeObject.runtime.onMessage.addListener(runtimeMessageListener);
      resolvedTabMarker.start();
      documentObject.addEventListener?.('click', clickListener, true);
      documentObject.addEventListener?.('keydown', keydownListener, true);
      documentObject.addEventListener?.('submit', submitListener, true);
      scan('initial');

      observer = new MutationObserverClass(() => scheduleScan('mutation'));
      observer.observe(documentObject.documentElement || documentObject.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'aria-label',
          'aria-disabled',
          'disabled',
          'data-message-author-role',
          'data-testid'
        ]
      });

      heartbeatTimer = setIntervalFn(() => scan('heartbeat'), 2000);
    }

    function stop() {
      if (!started) return;
      started = false;
      observer?.disconnect();
      observer = null;
      if (immediateTimer !== null) clearTimeoutFn(immediateTimer);
      if (settleTimer !== null) clearTimeoutFn(settleTimer);
      if (heartbeatTimer !== null) clearIntervalFn(heartbeatTimer);
      immediateTimer = null;
      settleTimer = null;
      heartbeatTimer = null;
      chromeObject.runtime.onMessage.removeListener?.(runtimeMessageListener);
      resolvedTabMarker.stop();
      documentObject.removeEventListener?.('click', clickListener, true);
      documentObject.removeEventListener?.('keydown', keydownListener, true);
      documentObject.removeEventListener?.('submit', submitListener, true);
    }

    function getDebug() {
      return {
        version: '0.8.0',
        url: windowObject.location.href,
        title: documentObject.title || 'ChatGPT',
        state: detector.getState(),
        tabMarker: resolvedTabMarker.getState(),
        lastSnapshot,
        lastDispatch,
        lastScanReason
      };
    }

    return { start, stop, scan, scheduleScan, markSubmission, getDebug };
  }

  return { createMonitor };
});
