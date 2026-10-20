const test = require('node:test');
const assert = require('node:assert/strict');
const { createDetector } = require('../detector-core.js');

function session(initial = {}) {
  const detector = createDetector();
  let snapshot = {
    now: 0, assistantCount: 1, userCount: 1,
    lastAssistantSignature: 'old', lastAssistantText: 'Previous reply',
    conversationSignature: 'old conversation', stopVisible: false, sendVisible: true,
    ...initial
  };
  detector.scan(snapshot);
  return {
    detector,
    scan(now, changes = {}) {
      snapshot = { ...snapshot, ...changes, now };
      return detector.scan(snapshot);
    }
  };
}

const reply = {
  assistantCount: 2, lastAssistantSignature: 'new', lastAssistantText: 'New reply',
  conversationSignature: 'new conversation', finalReady: true
};

test('submission and thinking status changes cannot complete the previous reply', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  assert.deepEqual(scan(100, { userCount: 2, sendVisible: false }), []);
  assert.deepEqual(scan(200, { conversationSignature: 'Thinking' }), []);
  assert.deepEqual(scan(10000, { sendVisible: true }), []);
  assert.deepEqual(scan(60000), []);
});

test('a long pause with new assistant content is not completion without a generation signal', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  assert.deepEqual(scan(100, reply), []);
  assert.deepEqual(scan(60000), []);
});

test('thinking or tool activity followed by idle controls cannot complete an old reply', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  assert.deepEqual(scan(100, { stopVisible: true, sendVisible: false }), []);
  assert.deepEqual(scan(1000, { conversationSignature: 'Tool running' }), []);
  assert.deepEqual(scan(60000, { stopVisible: false, sendVisible: true }), []);
  assert.deepEqual(scan(62000), []);
});

test('requires stable idle controls after generation ends, then notifies once', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { stopVisible: true, sendVisible: false });
  scan(200, reply);
  assert.deepEqual(scan(60000), []);
  assert.deepEqual(scan(60100, { stopVisible: false, sendVisible: true }), []);
  assert.deepEqual(scan(61499), []);
  assert.deepEqual(scan(61500), [{ type: 'response_complete', message: 'New reply' }]);
  assert.deepEqual(scan(100000), []);
});

test('a temporary disappearance of stop does not reuse time spent generating', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true, sendVisible: false });
  assert.deepEqual(scan(10000, { stopVisible: false, sendVisible: true }), []);
  assert.deepEqual(scan(11000, { stopVisible: true, sendVisible: false }), []);
  assert.deepEqual(scan(20000, { stopVisible: false, sendVisible: true }), []);
  assert.deepEqual(scan(21399), []);
  assert.equal(scan(21400)[0]?.type, 'response_complete');
});

test('new content during the completion grace period restarts the timer', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true, sendVisible: false });
  scan(1000, { stopVisible: false, sendVisible: true });
  assert.deepEqual(scan(2300, { lastAssistantSignature: 'final', lastAssistantText: 'Final reply' }), []);
  assert.deepEqual(scan(2400), []);
  assert.equal(scan(3700)[0]?.message, 'Final reply');
});

test('stop transition can start a cycle when the submission event was missed', () => {
  const { scan } = session();
  scan(100, { ...reply, stopVisible: true, sendVisible: false });
  scan(200, { stopVisible: false, sendVisible: true });
  assert.equal(scan(1600)[0]?.type, 'response_complete');
});

test('loading old history never produces a completion notification', () => {
  const { scan } = session();
  assert.deepEqual(scan(10000, reply), []);
  assert.deepEqual(scan(60000), []);
});

test('action-required events still work independently of completion', () => {
  const { scan } = session();
  assert.equal(scan(100, { actionFingerprint: 'allow', actionLabel: 'Action needed: Allow' })[0]?.type, 'action_required');
  assert.deepEqual(scan(10000), []);
});

test('two separate turns with identical replies can both notify', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true, sendVisible: false });
  scan(200, { stopVisible: false, sendVisible: true });
  assert.equal(scan(1600)[0]?.type, 'response_complete');
  detector.markUserSubmitted(2000);
  scan(2100, { assistantCount: 3, userCount: 3, stopVisible: true, sendVisible: false });
  scan(2200, { stopVisible: false, sendVisible: true });
  assert.equal(scan(3600)[0]?.type, 'response_complete');
});

test('a final reply completes with an empty composer and no Send control', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true, sendVisible: false });
  scan(200, { stopVisible: false });
  assert.equal(scan(1600)[0]?.type, 'response_complete');
});

test('commentary without final controls never completes even during a long tool gap', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, finalReady: false, stopVisible: true, sendVisible: false });
  scan(200, { stopVisible: false });
  assert.deepEqual(scan(60000), []);
  scan(60100, { finalReady: true });
  assert.equal(scan(61500)[0]?.type, 'response_complete');
});

test('manual Stop suppresses completion until the next submission', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true, sendVisible: false });
  detector.markUserStopped();
  scan(200, { stopVisible: false, sendVisible: true });
  assert.deepEqual(scan(60000), []);
  detector.markUserSubmitted(61000);
  scan(61100, { ...reply, assistantCount: 3, stopVisible: true });
  scan(61200, { stopVisible: false });
  assert.equal(scan(62600)[0]?.type, 'response_complete');
});

for (const blocker of ['streamingVisible']) {
  test(`${blocker} blocks completion and restarts stabilization when cleared`, () => {
    const { detector, scan } = session();
    detector.markUserSubmitted(10);
    scan(100, { ...reply, stopVisible: true });
    scan(200, { stopVisible: false, [blocker]: true });
    assert.deepEqual(scan(60000), []);
    scan(60100, { [blocker]: false });
    assert.deepEqual(scan(61000), []);
    assert.equal(scan(61500)[0]?.type, 'response_complete');
  });
}

test('approval waiting cannot also produce a completion event', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true });
  assert.deepEqual(scan(200, { stopVisible: false, actionFingerprint: 'allow' }).map(e => e.type), ['action_required']);
  assert.deepEqual(scan(60000), []);
});


test('an error cannot become a completed reply just because its banner is dismissed', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true });
  scan(200, { stopVisible: false, hasError: true });
  scan(300, { hasError: false });
  assert.deepEqual(scan(60000), []);
  assert.equal(detector.getState().errorObserved, true);
  // Retry/regenerate can begin a fresh cycle without a new user turn.
  scan(60100, { stopVisible: true });
  scan(60200, { ...reply, lastAssistantSignature: 'retry', stopVisible: false });
  assert.equal(scan(61600)[0]?.type, 'response_complete');
});

test('typing in the composer or unrelated page updates do not postpone a final reply', () => {
  const { detector, scan } = session();
  detector.markUserSubmitted(10);
  scan(100, { ...reply, stopVisible: true });
  scan(200, { stopVisible: false });
  scan(1000, { conversationSignature: 'composer draft 1' });
  assert.equal(scan(1600, { conversationSignature: 'composer draft 2' })[0]?.type, 'response_complete');
});
