const test = require('node:test');
const assert = require('node:assert/strict');
const { collectSnapshot } = require('../dom-adapter.js');

function fakeDocument(assistantNode) {
  const root = {
    innerText: 'User prompt Complete assistant response',
    textContent: 'User prompt Complete assistant response'
  };
  return {
    body: root,
    querySelector(selector) {
      return selector === 'main' ? root : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-message-author-role="assistant"]') return [assistantNode];
      if (selector === '[data-message-author-role="user"]') return [{}];
      if (selector === 'button,[role="button"]') return [];
      return [];
    }
  };
}

const windowObject = {
  getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' })
};

test('falls back from whitespace innerText to meaningful textContent', () => {
  const assistant = {
    innerText: '\n',
    textContent: 'The full response is available here.',
    querySelectorAll: () => []
  };

  const snapshot = collectSnapshot(fakeDocument(assistant), windowObject, 1);

  assert.equal(snapshot.lastAssistantText, 'The full response is available here.');
});

test('prefers complete response content over a one-character wrapper', () => {
  const content = {
    innerText: 'This is the complete assistant response with useful detail.',
    textContent: 'This is the complete assistant response with useful detail.'
  };
  const assistant = {
    innerText: 'T',
    textContent: 'T',
    querySelectorAll: () => [content]
  };

  const snapshot = collectSnapshot(fakeDocument(assistant), windowObject, 1);

  assert.equal(
    snapshot.lastAssistantText,
    'This is the complete assistant response with useful detail.'
  );
});

test('uses the beginning of a long response for the preview', () => {
  const response = `Important answer first. ${'supporting detail '.repeat(30)}Final footnote.`;
  const assistant = {
    innerText: response,
    textContent: response,
    querySelectorAll: () => []
  };

  const snapshot = collectSnapshot(fakeDocument(assistant), windowObject, 1);

  assert.match(snapshot.lastAssistantText, /^Important answer first\./);
  assert.match(snapshot.lastAssistantText, /…$/);
});
