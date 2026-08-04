(function initDomAdapter(root, factory) {
  const pageUtils =
    typeof module === 'object' && module.exports
      ? require('./page-utils.js')
      : root.ChatGPTNotifierPageUtils;
  const api = factory(pageUtils);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierDomAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function domAdapterFactory(utils) {
  const { normalizeText, hashText, isActionLabel, summarizeActionLabels } = utils;

  function elementLabel(element) {
    return normalizeText(
      element?.innerText ||
        element?.textContent ||
        element?.getAttribute?.('aria-label') ||
        element?.getAttribute?.('title') ||
        element?.getAttribute?.('data-testid') ||
        ''
    );
  }

  function controlIdentity(element) {
    return normalizeText([
      element?.getAttribute?.('data-testid'),
      element?.getAttribute?.('aria-label'),
      element?.getAttribute?.('title'),
      element?.innerText,
      element?.textContent
    ].filter(Boolean).join(' ')).toLowerCase();
  }

  function isVisible(element, windowObject) {
    if (!element || element.getAttribute?.('aria-hidden') === 'true') return false;
    if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) {
      return false;
    }

    try {
      const style = windowObject?.getComputedStyle?.(element);
      if (!style) return true;
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        String(style.opacity) !== '0'
      );
    } catch {
      return true;
    }
  }

  function isSendControl(element) {
    if (!element) return false;
    const identity = controlIdentity(element);
    return (
      /(^|\s)send-button(\s|$)/.test(identity) ||
      /(^|\s)composer-submit-button(\s|$)/.test(identity) ||
      /(^|\s)send( message| prompt)?(\s|$)/.test(identity)
    );
  }

  function isStopControl(element) {
    if (!element) return false;
    const identity = controlIdentity(element);
    return (
      /(^|\s)stop-button(\s|$)/.test(identity) ||
      /(^|\s)stop( generating| streaming| response)?(\s|$)/.test(identity)
    );
  }

  function isComposerInput(element) {
    if (!element) return false;
    const directTag = String(element.tagName || '').toUpperCase();
    if (directTag === 'TEXTAREA' || element.isContentEditable) return true;
    const role = element.getAttribute?.('role');
    if (role === 'textbox') return true;
    return Boolean(
      element.closest?.('textarea,[contenteditable="true"],[role="textbox"]')
    );
  }

  function conversationRoot(documentObject) {
    return (
      documentObject.querySelector?.('main') ||
      documentObject.querySelector?.('[role="main"]') ||
      documentObject.body ||
      documentObject.documentElement ||
      null
    );
  }

  function longestNormalizedText(elements) {
    let longest = '';
    for (const element of elements) {
      for (const value of [element?.innerText, element?.textContent]) {
        const text = normalizeText(value);
        if (text.length > longest.length) longest = text;
      }
    }
    return longest;
  }

  function assistantText(element) {
    if (!element) return '';
    const contentNodes = Array.from(
      element.querySelectorAll?.(
        '[data-message-content], .markdown, [class~="prose"]'
      ) || []
    );
    return longestNormalizedText(contentNodes) || longestNormalizedText([element]);
  }

  function preview(value, maxLength = 220) {
    const text = normalizeText(value);
    if (text.length <= maxLength) return text;

    const slice = text.slice(0, maxLength - 1);
    const lastSpace = slice.lastIndexOf(' ');
    const cutoff = lastSpace >= Math.floor(maxLength * 0.65) ? lastSpace : slice.length;
    return `${slice.slice(0, cutoff).trimEnd()}…`;
  }

  function tail(value, maxLength = 220) {
    const text = normalizeText(value);
    if (text.length <= maxLength) return text;
    return `…${text.slice(-(maxLength - 1)).trimStart()}`;
  }

  function collectSnapshot(documentObject, windowObject, now = Date.now()) {
    const assistantNodes = Array.from(
      documentObject.querySelectorAll('[data-message-author-role="assistant"]')
    );
    const userNodes = Array.from(
      documentObject.querySelectorAll('[data-message-author-role="user"]')
    );
    const buttons = Array.from(documentObject.querySelectorAll('button,[role="button"]'));

    const lastAssistant = assistantNodes.at(-1);
    const fullAssistantText = assistantText(lastAssistant);
    const lastAssistantText = preview(fullAssistantText);

    const visibleButtons = buttons.filter((button) => isVisible(button, windowObject));
    const stopVisible = visibleButtons.some(isStopControl);
    const sendVisible = visibleButtons.some(isSendControl);

    const actionLabels = [...new Set(
      visibleButtons
        .filter((button) => !button.disabled)
        .map(elementLabel)
        .filter(isActionLabel)
    )];
    const actionFingerprint = actionLabels.length
      ? actionLabels.map((label) => label.toLowerCase()).sort().join('|')
      : null;

    const root = conversationRoot(documentObject);
    const fullConversationText = normalizeText(root?.innerText || root?.textContent || '');
    const boundedConversationText = fullConversationText.slice(-24000);

    return {
      now,
      stopVisible,
      sendVisible,
      assistantCount: assistantNodes.length,
      userCount: userNodes.length,
      lastAssistantSignature: assistantNodes.length ? hashText(fullAssistantText) : '',
      lastAssistantText,
      conversationSignature: hashText(boundedConversationText),
      conversationTail: tail(fullConversationText),
      actionFingerprint,
      actionLabel: actionFingerprint ? summarizeActionLabels(actionLabels) : null
    };
  }

  return {
    collectSnapshot,
    elementLabel,
    isVisible,
    isSendControl,
    isStopControl,
    isComposerInput,
    conversationRoot
  };
});
