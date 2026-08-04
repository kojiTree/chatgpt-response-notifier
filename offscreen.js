const PLAY_SOUND = 'PLAY_SOUND';
const CHIME_PARTS = [
  'sounds/chime.part0',
  'sounds/chime.part1',
  'sounds/chime.part2',
  'sounds/chime.part3',
  'sounds/chime.part4',
  'sounds/chime.part5'
];

let audioPromise = null;

function clampVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return 0.7;
  return Math.min(1, Math.max(0, volume));
}

async function createAudio() {
  const responses = await Promise.all(
    CHIME_PARTS.map((path) => fetch(chrome.runtime.getURL(path)))
  );

  const failedResponse = responses.find((response) => !response.ok);
  if (failedResponse) {
    throw new Error(`Could not load chime asset: HTTP ${failedResponse.status}`);
  }

  const buffers = await Promise.all(responses.map((response) => response.arrayBuffer()));
  const blob = new Blob(buffers, { type: 'audio/mpeg' });
  const audio = new Audio(URL.createObjectURL(blob));
  audio.preload = 'auto';
  return audio;
}

function getAudio() {
  if (!audioPromise) audioPromise = createAudio();
  return audioPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message?.type !== PLAY_SOUND) {
    return false;
  }

  getAudio()
    .then((audio) => {
      audio.volume = clampVolume(message.volume);
      audio.currentTime = 0;
      return audio.play();
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});
