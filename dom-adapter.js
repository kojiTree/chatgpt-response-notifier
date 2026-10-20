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
  const nodeKeys = new WeakMap();
  let nextNodeKey = 0;

  function nodeKey(node) {
    if (!node) return '';
    const explicit = node.getAttribute?.('data-message-id') || node.getAttribute?.('data-turn-id') ||
      node.getAttribute?.('data-turn-key');
    if (explicit) return explicit;
    if (!nodeKeys.has(node)) nodeKeys.set(node, `node:${++nextNodeKey}`);
    return nodeKeys.get(node);
  }

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
    if (element.closest?.('[hidden], [aria-hidden="true"], [inert]')) return false;
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
    if (!element || isStopControl(element)) return false;
    const identity = controlIdentity(element);
    return (
      /(^|\s)send-button(\s|$)/.test(identity) ||
      /(^|\s)composer-submit-button(\s|$)/.test(identity) ||
      /(^|\s)send( message| prompt)?(\s|$)/.test(identity)
    );
  }

  function isStopControl(element) {
    if (!element) return false;
    if (element.getAttribute?.('data-testid') === 'stop-button') return true;
    return ['aria-label', 'title'].some((attribute) =>
      /^(stop( generating| streaming| response)?|生成を停止(する)?|応答を停止(する)?|ストリーミングを停止(する)?)$/i
        .test(normalizeText(element.getAttribute?.(attribute)))) ||
      /^stop( generating| streaming| response)?$/i.test(normalizeText(element.innerText));
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

  function latestReply(documentObject, windowObject) {
    const users = Array.from(documentObject.querySelectorAll(
      '[data-message-author-role="user"], [data-turn="user"], [data-chatgpt-search-message-ids]'
    )).filter((node) => isVisible(node, windowObject) && !node.closest?.('nav, aside, form') &&
      (!node.hasAttribute?.('data-chatgpt-search-message-ids') ||
        !node.hasAttribute?.('data-content-search-unit-key')));
    const user = users.at(-1);
    const candidates = Array.from(documentObject.querySelectorAll(
      '[data-message-author-role="assistant"], [data-turn="assistant"], [data-chatgpt-agent-turn-start]'
    )).filter((node) => !node.closest?.('nav, aside, form, [hidden], [aria-hidden="true"], [inert]') &&
      (node.hasAttribute?.('data-chatgpt-agent-turn-start') || isVisible(node, windowObject)));
    const current = candidates.filter((node) => !user || Boolean(user.compareDocumentPosition?.(node) & 4));
    const assistant = current.at(-1);
    const turn = assistant?.closest?.('[data-turn-key], [data-turn="assistant"], [data-testid^="conversation-turn-"], article') || assistant;
    const content = Array.from(turn?.querySelectorAll?.(
      '[data-message-content], .markdown, [class~="prose"], [class*="MarkdownRoot"]'
    ) || []).filter((node) => isVisible(node, windowObject) && !node.closest?.(
      '[data-message-author-role="user"], [data-turn="user"], .rich-text-user-turn, .bg-user-message, [data-testid^="cot-v5-"]'
    ));
    // Prefer the final content branch over reasoning/status siblings. Never
    // use a whole modern turn, which can also contain the user's prompt.
    const branches = content.filter((node) => !content.some((other) => other !== node && other.contains?.(node)));
    const text = branches.length ? longestNormalizedText([branches.at(-1)]) :
      assistant?.getAttribute?.('data-message-author-role') === 'assistant' ? assistantText(assistant) : '';
    return { user, users, assistant, candidates, turn, text };
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
    const reply = latestReply(documentObject, windowObject);
    const assistantNodes = reply.candidates;
    const userNodes = reply.users;
    const buttons = Array.from(documentObject.querySelectorAll('button,[role="button"]'));

    const fullAssistantText = reply.text;
    const lastAssistantText = preview(fullAssistantText);

    const visibleButtons = buttons.filter((button) => isVisible(button, windowObject));
    const stopVisible = visibleButtons.some(isStopControl);
    const sendVisible = visibleButtons.some(isSendControl);

    const belongsToCurrent = (node) => {
      if (node.closest?.('pre, code, nav, aside')) return false;
      const owner = node.closest?.('[data-turn-key], [data-turn], [data-testid^="conversation-turn-"], article');
      return !owner || owner === reply.turn || owner === reply.user?.closest?.('[data-turn-key], [data-turn], article');
    };
    const actionLabels = [...new Set(
      visibleButtons
        .filter((button) => !button.disabled && belongsToCurrent(button))
        .map(elementLabel)
        .filter(isActionLabel)
    )];
    const actionFingerprint = actionLabels.length
      ? actionLabels.map((label) => label.toLowerCase()).sort().join('|')
      : null;

    const root = conversationRoot(documentObject);
    const fullConversationText = normalizeText(root?.innerText || root?.textContent || '');
    const boundedConversationText = fullConversationText.slice(-24000);
    const visibleInReply = (selector) => Array.from(reply.turn?.querySelectorAll?.(selector) || [])
      .some((node) => isVisible(node, windowObject) && !node.closest?.('pre, code'));
    const finalReady = Boolean(fullAssistantText) && visibleInReply('[data-testid="copy-turn-action-button"]');
    const streamingVisible = Boolean(reply.turn?.matches?.('.streaming-animation, [aria-busy="true"]')) ||
      visibleInReply('.streaming-animation, [aria-busy="true"], [data-is-streaming="true"], [data-streaming="true"], .loading-shimmer, .loading-shimmer-tertiary');
    const hasError = Array.from(root?.querySelectorAll?.(
      '[role="alert"], [data-testid*="error" i], [data-testid*="rate-limit" i]'
    ) || []).some((node) => belongsToCurrent(node) && isVisible(node, windowObject) &&
      /error|failed|something went wrong|rate limit|try again|エラー|失敗|問題が発生|上限/i.test(elementLabel(node)));

    return {
      now,
      stopVisible,
      sendVisible,
      finalReady,
      streamingVisible,
      hasError,
      lastAssistantKey: nodeKey(reply.assistant),
      lastUserKey: nodeKey(reply.user),
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
    latestReply,
    isComposerInput,
    conversationRoot
  };
});
