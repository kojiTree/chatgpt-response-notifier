# ChatGPT Response Notifier

A lightweight Chrome extension that alerts you when ChatGPT finishes responding or needs your approval.

## Features

- Desktop notifications that automatically disappear after 10 seconds
- No desktop notification when the source ChatGPT tab is already active and focused
- Visual tab highlighting so you can identify which ChatGPT tab finished
- Optional custom chime with adjustable volume
- Detection of completed responses and action-required states
- Support for multiple ChatGPT tabs
- Diagnostic notification and sound tests from the popup

## Install locally

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Open or refresh a ChatGPT tab.

## Usage

Open the extension popup to enable or disable desktop alerts, tab highlighting, and sound. The popup also shows notification permission, connected ChatGPT tabs, and the last detected event.

## Supported sites

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## Version

Current manifest version: **0.8.1**.

## Completion detection

The extension waits for an observed Stop control, new assistant content after the
latest user prompt, and the reply's Copy action control. Completion requires
these final-output signals to remain stable for 1.4 seconds with no detected
streaming, busy tool/status indicator, error, or approval/Continue prompt.
The Send button is not required: ChatGPT can hide it when the composer is empty.
Clicking Stop cancels completion notification for that cycle. A detected error
also cancels the cycle; retrying can start a new one.

The adapter supports legacy author-role/message containers and the newer
`data-turn-key` / `data-chatgpt-agent-turn-start` structure. Historical replies,
errors, approvals, and code examples are excluded from current-turn evidence.

These are DOM heuristics, not an official ChatGPT completion API. An unknown UI,
missing Stop/Copy controls, or output without readable assistant text can cause a
missed notification. An unrecognized intermediate state can still cause an
incorrect notification. Current signed-in ChatGPT behavior needs manual
verification; synthetic HTML tests cannot establish live-site compatibility.
Diagnostics expose `finalReady`, `streamingVisible`, `hasError`, message keys,
`stopObserved`, `responseObserved`, `manuallyStopped`, and `errorObserved`.

### Tests

Run `npm ci` then `npm test` (Node.js 18 or later). Test dependencies are for
development only; the unpacked Chrome extension does not require Node.js.
HTML fixtures use jsdom with simulated layout presence, not a rendering browser
or captured user conversations. They test DOM extraction through completion
classification and the monitor's captured Stop click.

### Live verification before merging

Reload the extension in `chrome://extensions` and refresh the ChatGPT tab, then
check a short reply with an empty composer, a long thinking/tool response, a
manual Stop, approval waiting, and two conversations in separate tabs. There
should be one completion notification after the final answer, none during
intermediate pauses or after manual Stop, and approval notifications should
remain independent. If detection fails, inspect the popup diagnostics during
both generation and completion. This live verification is still outstanding.

### Reference implementations

These unofficial sources informed the selector choices and completion checks;
they do not guarantee compatibility with every ChatGPT UI rollout.

- [ChatGPT Bridge turn discovery](https://github.com/DrA1ex/chatgpt-bridge/blob/main/tools/chrome-bridge-extension/content/currentTurnDom.js)
- [ChatGPT Bridge turn UI signals](https://github.com/DrA1ex/chatgpt-bridge/blob/main/tools/chrome-bridge-extension/content/turnUiSignals.js)
- [DOM observations from 2026-05-21](https://github.com/Dworrall21/chatgpt-bridge/blob/main/dom-selectors.md)
