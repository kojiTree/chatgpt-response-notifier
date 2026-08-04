(function initTabMarker(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierTabMarker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function tabMarkerFactory() {
  const MARKER_LINK_ID = 'chatgpt-notifier-tab-marker';
  const MARKERS = {
    response_complete: {
      prefix: '🔔 Ready — ',
      background: '#10a37f',
      glyph: '<path d="M16 5a5 5 0 0 0-5 5v3.4c0 1.3-.5 2.5-1.4 3.4L8 18.4V21h16v-2.6l-1.6-1.6c-.9-.9-1.4-2.1-1.4-3.4V10a5 5 0 0 0-5-5Zm-2.4 18a2.7 2.7 0 0 0 4.8 0h-4.8Z" fill="white"/>'
    },
    action_required: {
      prefix: '⚠ Action needed — ',
      background: '#f59e0b',
      glyph: '<path d="M16 7.2c.9 0 1.6.7 1.6 1.6v7.1a1.6 1.6 0 1 1-3.2 0V8.8c0-.9.7-1.6 1.6-1.6Zm0 14.1a1.8 1.8 0 1 1 0-3.6 1.8 1.8 0 0 1 0 3.6Z" fill="white"/>'
    }
  };

  function markerFor(eventType) {
    return eventType === 'action_required' ? MARKERS.action_required : MARKERS.response_complete;
  }

  function hasMarkerPrefix(title) {
    return Object.values(MARKERS).some((marker) => String(title || '').startsWith(marker.prefix));
  }

  function stripMarkerPrefix(title) {
    const value = String(title || '');
    for (const marker of Object.values(MARKERS)) {
      if (value.startsWith(marker.prefix)) return value.slice(marker.prefix.length);
    }
    return value;
  }

  function faviconDataUrl(marker) {
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
      `<circle cx="16" cy="16" r="15" fill="${marker.background}"/>`,
      '<circle cx="16" cy="16" r="14" fill="none" stroke="white" stroke-opacity=".35"/>',
      marker.glyph,
      '</svg>'
    ].join('');
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  function createTabMarker({ documentObject, windowObject }) {
    let eventType = null;
    let baseTitle = stripMarkerPrefix(documentObject?.title || 'ChatGPT') || 'ChatGPT';
    let started = false;

    function getMarkerLink() {
      return documentObject?.getElementById?.(MARKER_LINK_ID) || null;
    }

    function ensureMarkerLink(marker) {
      if (!documentObject?.head || !documentObject?.createElement) return null;
      let link = getMarkerLink();
      if (!link) {
        link = documentObject.createElement('link');
        link.id = MARKER_LINK_ID;
        link.rel = 'icon';
        link.type = 'image/svg+xml';
        documentObject.head.appendChild(link);
      }
      link.href = faviconDataUrl(marker);
      return link;
    }

    function sync() {
      if (!eventType) return false;
      const marker = markerFor(eventType);
      const currentTitle = String(documentObject?.title || 'ChatGPT');

      if (!hasMarkerPrefix(currentTitle)) {
        baseTitle = stripMarkerPrefix(currentTitle) || baseTitle;
      }

      const markedTitle = `${marker.prefix}${baseTitle}`;
      if (documentObject && documentObject.title !== markedTitle) {
        documentObject.title = markedTitle;
      }
      ensureMarkerLink(marker);
      return true;
    }

    function mark(nextEventType) {
      const currentTitle = String(documentObject?.title || 'ChatGPT');
      if (!hasMarkerPrefix(currentTitle)) {
        baseTitle = stripMarkerPrefix(currentTitle) || baseTitle;
      }
      eventType = nextEventType === 'action_required' ? 'action_required' : 'response_complete';
      sync();
      return true;
    }

    function clear() {
      const link = getMarkerLink();
      if (!eventType && !link && !hasMarkerPrefix(documentObject?.title)) return false;

      const currentTitle = String(documentObject?.title || '');
      if (hasMarkerPrefix(currentTitle) && documentObject) {
        documentObject.title = baseTitle || stripMarkerPrefix(currentTitle) || 'ChatGPT';
      }
      link?.remove?.();
      eventType = null;
      return true;
    }

    function userIsViewingTab() {
      const visible = documentObject?.visibilityState !== 'hidden';
      const focused = typeof documentObject?.hasFocus !== 'function' || documentObject.hasFocus();
      return visible && focused;
    }

    function clearWhenViewed() {
      if (userIsViewingTab()) clear();
    }

    function start() {
      if (started) return;
      started = true;
      documentObject?.addEventListener?.('visibilitychange', clearWhenViewed, true);
      windowObject?.addEventListener?.('focus', clearWhenViewed, true);
    }

    function stop() {
      if (!started) return;
      started = false;
      documentObject?.removeEventListener?.('visibilitychange', clearWhenViewed, true);
      windowObject?.removeEventListener?.('focus', clearWhenViewed, true);
    }

    function isMarked() {
      return Boolean(eventType);
    }

    function getState() {
      return {
        marked: isMarked(),
        eventType,
        baseTitle,
        displayedTitle: String(documentObject?.title || '')
      };
    }

    return { start, stop, mark, clear, sync, isMarked, getState };
  }

  return { createTabMarker, stripMarkerPrefix, MARKER_LINK_ID };
});
