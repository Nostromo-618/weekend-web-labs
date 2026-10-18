import { KOKORO_VOICES } from './speech/voices.js';
const KEY = 'wwl-chat-settings-v1';
const defaults = {
  delivery: 'checked-stream',
  provider: 'neural',
  voiceId: 'af_heart',
  voiceURI: '',
  flowchartOpen: true,
  flowchartRatio: 0.3,
  inspectorOpen: true,
};
function readRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0.05 || ratio >= 0.95 || Math.abs(ratio - 0.58) < 0.01) {
    return defaults.flowchartRatio;
  }
  return ratio;
}
export function readChatPreferences() {
  let value = {};
  try {
    value = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    /* storage denied */
  }
  return {
    delivery: value.delivery === 'complete' ? 'complete' : defaults.delivery,
    provider: value.provider === 'system' ? 'system' : defaults.provider,
    voiceId: KOKORO_VOICES.some((v) => v.id === value.voiceId) ? value.voiceId : defaults.voiceId,
    voiceURI: typeof value.voiceURI === 'string' ? value.voiceURI.slice(0, 1024) : '',
    flowchartOpen: value.flowchartOpen !== false,
    flowchartRatio: readRatio(value.flowchartRatio),
    inspectorOpen: value.inspectorOpen !== false,
  };
}
export function saveChatPreferences(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readChatPreferences(), ...patch }));
  } catch {
    /* storage denied */
  }
}
