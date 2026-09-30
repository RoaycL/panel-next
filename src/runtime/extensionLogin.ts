import { ref } from 'vue'

// Keep authentication on top of the dashboard instead of replacing the tab.
export const extensionLoginVisible = ref(false)

export function openExtensionLogin() {
  extensionLoginVisible.value = true
}
