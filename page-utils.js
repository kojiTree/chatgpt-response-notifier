(function initPageUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ChatGPTNotifierPageUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function pageUtilsFactory() {
  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function hashText(value) {
    const text = normalizeText(value);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`;
  }

  function isActionLabel(value) {
    const label = normalizeText(value).toLowerCase();
    if (!label || label.length > 80) return false;

    return [
      /^(approve|confirm|proceed|accept|authorize|grant)(\b|$)/,
      /^allow(\b|$)/,
      /^always allow(\b|$)/,
      /^continue( generating)?$/,
      /^run( tool| command| action)?$/,
      /^retry(\b|$)/,
      /^resume(\b|$)/
    ].some((pattern) => pattern.test(label));
  }

  function summarizeActionLabels(labels) {
    const unique = [...new Set(labels.map(normalizeText).filter(Boolean))].slice(0, 3);
    if (unique.length === 0) return 'ChatGPT is waiting for your action.';
    if (unique.length === 1) return `Action needed: ${unique[0]}`;
    if (unique.length === 2) return `Action needed: ${unique[0]} or ${unique[1]}`;
    return `Action needed: ${unique[0]}, ${unique[1]}, or ${unique[2]}`;
  }

  return { normalizeText, hashText, isActionLabel, summarizeActionLabels };
});
