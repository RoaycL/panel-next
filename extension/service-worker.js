import { createUpdateChecker, UPDATE_ALARM, UPDATE_INTERVAL_MINUTES } from './update-check.mjs'

const check = createUpdateChecker({ storage: chrome.storage.local, fetcher: fetch, currentVersion: chrome.runtime.getManifest().version })
async function ensureAlarm() {
  const alarm = await chrome.alarms.get(UPDATE_ALARM)
  if (!alarm || alarm.periodInMinutes !== UPDATE_INTERVAL_MINUTES)
    chrome.alarms.create(UPDATE_ALARM, { delayInMinutes: UPDATE_INTERVAL_MINUTES, periodInMinutes: UPDATE_INTERVAL_MINUTES })
}
function start() { void ensureAlarm().then(check).catch(() => {}) }
chrome.runtime.onInstalled.addListener(start)
chrome.runtime.onStartup.addListener(start)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) void check().catch(() => {})
})
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'panel-next-check-update') return
  void ensureAlarm().then(check).then(respond).catch(() => respond({ error: '暂时无法检查更新，请稍后重试' }))
  return true
})
// Alarms may be lost after a browser restart or extension reload.
void ensureAlarm().catch(() => {})
