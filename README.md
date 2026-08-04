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

Current manifest version: **0.8.0**.
