const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { collectSnapshot, isStopControl, isSendControl } = require('../dom-adapter.js');
const { createDetector } = require('../detector-core.js');

function page(html) {
  const dom = new JSDOM(`<main>${html}</main>`, { url: 'https://chatgpt.com/c/fixture' });
  // jsdom parses actual selectors/DOM but has no layout engine. Supply layout
  // presence only; these are synthetic fixtures, not captured live-site HTML.
  dom.window.Element.prototype.getClientRects = function () {
    if (this.closest('[hidden], [aria-hidden="true"], [inert]')) return [];
    for (let node = this; node; node = node.parentElement) {
      const style = dom.window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') return [];
    }
    return [{}];
  };
  const snapshot = (now = 0) => collectSnapshot(dom.window.document, dom.window, now);
  return { dom, document: dom.window.document, window: dom.window, snapshot };
}
const user = '<article data-turn="user" data-turn-id="u"><div data-message-author-role="user">Question</div></article>';
const copy = '<button data-testid="copy-turn-action-button" aria-label="Copy"></button>';
const response = (text, extra = '') => `<article data-turn="assistant" data-turn-id="a"><div data-message-author-role="assistant" data-message-id="answer"><div class="markdown">${text}</div></div>${extra}</article>`;
const stop = '<button data-testid="stop-button" aria-label="Stop streaming"></button>';

test('legacy HTML: completed reply with Copy and no Send is detected', () => {
  const p = page(user + response('Answer', copy));
  const s = p.snapshot();
  assert.equal(s.lastAssistantText, 'Answer');
  assert.equal(s.finalReady, true);
  assert.equal(s.sendVisible, false);
  assert.equal(s.lastAssistantKey, 'answer');
  p.window.close();
});

test('new turn-key HTML without author-role attributes is detected', () => {
  const p = page(`<section data-turn-key="turn-1"><div data-chatgpt-search-message-ids="u" class="group/user-message"><div class="rich-text-user-turn">Question</div></div><div><span data-chatgpt-agent-turn-start style="display:none"></span><div class="MarkdownRoot">New answer</div>${copy}</div></section>`);
  const s = p.snapshot();
  assert.equal(s.lastAssistantText, 'New answer');
  assert.equal(s.finalReady, true);
  p.window.close();
});

test('old Copy controls cannot finalize a reply after the latest user prompt', () => {
  const p = page(response('Old answer', copy) + user + response('Working on it'));
  assert.equal(p.snapshot().lastAssistantText, 'Working on it');
  assert.equal(p.snapshot().finalReady, false);
  p.document.querySelector('main').innerHTML = response('Old answer', copy) + user;
  assert.equal(p.snapshot().lastAssistantText, '');
  assert.equal(p.snapshot().finalReady, false);
  p.window.close();
});

test('reasoning and user content do not replace the final answer', () => {
  const p = page(user + `<article data-turn="assistant"><div data-testid="cot-v5-summary"><div class="markdown">Thinking text</div></div><div data-message-author-role="assistant"><div class="MarkdownRoot">Final <span class="prose">nested detail</span> ending</div></div>${copy}</article>`);
  assert.equal(p.snapshot().lastAssistantText, 'Final nested detail ending');
  p.window.close();
});

test('streaming, active tools, errors, and current approvals are exposed as blockers', () => {
  const p = page(user + response('Answer', `${copy}<div class="streaming-animation">more</div><div role="alert">An error occurred</div><button>Allow</button>`));
  let s = p.snapshot();
  assert.equal(s.streamingVisible, true);
  assert.equal(s.hasError, true);
  assert.equal(s.actionFingerprint, 'allow');
  p.document.querySelector('.streaming-animation').className = '';
  p.document.querySelector('[role="alert"]').hidden = true;
  p.document.querySelector('article[data-turn="assistant"]').insertAdjacentHTML('beforeend', '<div aria-busy="true">Tool running</div>');
  s = p.snapshot();
  assert.equal(s.streamingVisible, true);
  assert.equal(s.hasError, false);
  p.window.close();
});

test('historical approvals/errors and code examples do not block the latest reply', () => {
  const p = page(response('Old', '<div role="alert">Error</div><button>Allow</button>') + user + response('Answer', `${copy}<pre><code><button>Confirm</button><span role="alert">Error</span></code></pre>`));
  assert.equal(p.snapshot().hasError, false);
  assert.equal(p.snapshot().actionFingerprint, null);
  p.window.close();
});

test('Stop dictation is not response generation, and a Stop control is never Send', () => {
  const p = page('<button id="dictation" aria-label="Stop dictation"></button><button id="generate" data-testid="stop-button" aria-label="Send prompt"></button><button id="ja" aria-label="応答を停止する"></button>');
  assert.equal(isStopControl(p.document.querySelector('#dictation')), false);
  assert.equal(isStopControl(p.document.querySelector('#generate')), true);
  assert.equal(isSendControl(p.document.querySelector('#generate')), false);
  assert.equal(isStopControl(p.document.querySelector('#ja')), true);
  p.window.close();
});

test('DOM snapshots through the detector: tool gap, final answer, then one notification', () => {
  const p = page(user);
  const detector = createDetector();
  detector.scan(p.snapshot());
  detector.markUserSubmitted(10);
  p.document.querySelector('main').insertAdjacentHTML('beforeend', response('Working on it') + stop);
  assert.deepEqual(detector.scan(p.snapshot(100)), []);
  p.document.querySelector('[data-testid="stop-button"]').remove();
  assert.deepEqual(detector.scan(p.snapshot(60000)), []);
  p.document.querySelector('[data-turn="assistant"] .markdown').textContent = 'Final answer';
  p.document.querySelector('[data-turn="assistant"]').insertAdjacentHTML('beforeend', copy);
  assert.deepEqual(detector.scan(p.snapshot(60100)), []);
  assert.equal(detector.scan(p.snapshot(61500))[0]?.message, 'Final answer');
  assert.deepEqual(detector.scan(p.snapshot(70000)), []);
  p.window.close();
});

test('monitor captures a real Stop click before DOM removal, suppressing sound events', () => {
  const p = page(user);
  const { createMonitor } = require('../content-script.js');
  let now = 0;
  const messages = [];
  const monitor = createMonitor({
    documentObject: p.document, windowObject: p.window,
    chromeObject: { runtime: { onMessage: { addListener() {}, removeListener() {} }, sendMessage(message, callback) { messages.push(message); callback({ ok: true }); } } },
    now: () => now,
    setTimeoutFn: () => 1, clearTimeoutFn() {}, setIntervalFn: () => 1, clearIntervalFn() {},
    MutationObserverClass: p.window.MutationObserver,
    tabMarker: { start() {}, stop() {}, sync() {}, getState() { return {}; } }
  });
  monitor.start();
  monitor.markSubmission('fixture');
  p.document.querySelector('main').insertAdjacentHTML('beforeend', response('Partial answer', copy) + stop);
  now = 100;
  monitor.scan();
  p.document.querySelector('[data-testid="stop-button"]').click();
  p.document.querySelector('[data-testid="stop-button"]').remove();
  now = 200; monitor.scan();
  now = 10000; monitor.scan();
  assert.deepEqual(messages, []);
  assert.equal(monitor.getDebug().state.manuallyStopped, true);
  monitor.stop();
  p.window.close();
});
