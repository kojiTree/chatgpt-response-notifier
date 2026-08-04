const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWorker() {
  let notificationOptions = null;
  const context = {
    console,
    Date,
    tabsGet: async () => ({ active: false, windowId: 1 }),
    storageGet: async () => ({
      enabled: true,
      soundEnabled: false,
      tabMarkerEnabled: false
    }),
    storageSet: async () => {},
    markSourceTab: async () => ({ ok: true }),
    createNotification: async (_id, options) => {
      notificationOptions = options;
      return 'notification-id';
    },
    scheduleNotificationClear: () => {},
    playNotificationSound: async () => ({ ok: true })
  };

  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../service-worker/part3.js'), 'utf8'),
    context
  );
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '../service-worker/part4.js'), 'utf8'),
    context
  );

  return {
    context,
    getNotificationOptions: () => notificationOptions
  };
}

test('response notification heading includes the conversation title', async () => {
  const { context, getNotificationOptions } = loadWorker();

  await context.handleChatGPTEvent(
    {
      event: { type: 'response_complete', message: 'The response preview.' },
      page: {
        title: 'ChatGPT Notifier Customization',
        url: 'https://chatgpt.com/c/test'
      }
    },
    {
      tab: {
        id: 42,
        title: 'Fallback title',
        url: 'https://chatgpt.com/c/test'
      }
    }
  );

  assert.equal(
    getNotificationOptions().title,
    'Response ready · ChatGPT Notifier Customization'
  );
});

test('action notification heading includes the conversation title', async () => {
  const { context, getNotificationOptions } = loadWorker();

  await context.handleChatGPTEvent(
    {
      event: { type: 'action_required', message: 'Action needed: Allow' },
      page: {
        title: 'Deploy production app',
        url: 'https://chatgpt.com/c/test'
      }
    },
    {
      tab: {
        id: 42,
        title: 'Fallback title',
        url: 'https://chatgpt.com/c/test'
      }
    }
  );

  assert.equal(
    getNotificationOptions().title,
    'Action needed · Deploy production app'
  );
});
