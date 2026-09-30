<script setup lang="ts">
import { ref } from 'vue'
import App from '@/App.vue'
import { getRuntime } from '@/runtime'

const runtime = getRuntime()
const configuredOrigin = runtime.getServerOrigin()
const serverUrl = ref(configuredOrigin ?? '')
const showSetup = ref(!configuredOrigin)
const connecting = ref(false)
const errorMessage = ref('')

async function connect() {
  connecting.value = true
  errorMessage.value = ''
  try {
    await runtime.configureServer(serverUrl.value)
    window.location.reload()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法连接服务器。'
  }
  finally {
    connecting.value = false
  }
}

function cancel() {
  serverUrl.value = configuredOrigin ?? ''
  errorMessage.value = ''
  showSetup.value = false
}
</script>

<template>
  <App v-if="!showSetup" />

  <main v-else class="server-setup">
    <section class="server-card">
      <header class="server-heading">
        <img class="server-logo" src="/logo.png" alt="">
        <div>
          <p class="server-eyebrow">
            PANEL NEXT
          </p>
          <h1>{{ configuredOrigin ? '切换服务器' : '连接你的服务器' }}</h1>
        </div>
      </header>
      <p class="server-description">
        输入 Panel Next 或兼容 Sun-Panel 服务的 Origin。扩展只会申请访问这个地址，并按服务器隔离本地会话。
      </p>

      <form @submit.prevent="connect">
        <label for="server-origin">服务器地址</label>
        <input
          id="server-origin"
          v-model="serverUrl"
          type="url"
          inputmode="url"
          autocomplete="url"
          placeholder="https://panel.example.com"
          :disabled="connecting"
          autofocus
        >
        <p class="server-hint">
          仅填写 Origin，不要带 /api 或其他路径。本地服务可使用 http://。
        </p>
        <p v-if="errorMessage" class="server-error" role="alert">
          {{ errorMessage }}
        </p>
        <div class="server-actions">
          <button v-if="configuredOrigin" type="button" class="secondary" :disabled="connecting" @click="cancel">
            取消
          </button>
          <button type="submit" class="primary" :disabled="connecting || !serverUrl.trim()">
            {{ connecting ? '正在验证…' : '授权并连接' }}
          </button>
        </div>
      </form>
    </section>
  </main>

  <button v-if="!showSetup" class="server-switch" type="button" title="切换 Panel 服务器" @click="showSetup = true">
    服务器
  </button>
</template>

<style scoped>
.server-setup {
  --setup-accent: #0f9f75;
  --setup-accent-hover: #0b8a66;
  --setup-page: #eef8ff;
  --setup-surface: rgb(255 255 255 / 68%);
  --setup-surface-muted: rgb(237 245 244 / 48%);
  --setup-border: rgb(100 116 139 / 20%);
  --setup-text: #0f172a;
  --setup-text-secondary: #475569;
  --setup-text-muted: #64748b;
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: clamp(18px, 5vw, 48px);
  color: var(--setup-text);
  background:
    radial-gradient(circle at 15% 10%, rgb(16 185 129 / 20%), transparent 38%),
    radial-gradient(circle at 85% 85%, rgb(14 165 233 / 18%), transparent 40%),
    var(--setup-page);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.server-card {
  width: min(100%, 480px);
  padding: 40px;
  border: 1px solid var(--setup-border);
  border-radius: 18px;
  background: var(--setup-surface);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 35%), 0 22px 60px rgb(15 23 42 / 18%);
  -webkit-backdrop-filter: blur(28px) saturate(155%);
  backdrop-filter: blur(28px) saturate(155%);
}

.server-heading {
  display: flex;
  align-items: center;
  gap: 16px;
}

.server-logo {
  width: 56px;
  height: 56px;
  flex: 0 0 auto;
  border-radius: 12px;
  box-shadow: 0 8px 20px rgb(15 23 42 / 14%);
}

.server-eyebrow {
  margin: 0 0 5px;
  color: var(--setup-accent);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .16em;
}

h1 {
  margin: 0;
  font-size: clamp(25px, 6vw, 30px);
  letter-spacing: -.035em;
  line-height: 1.25;
}

.server-description {
  margin: 24px 0 28px;
  color: var(--setup-text-secondary);
  line-height: 1.7;
}

label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
}

input {
  box-sizing: border-box;
  width: 100%;
  padding: 13px 14px;
  border: 1px solid var(--setup-border);
  border-radius: 12px;
  color: inherit;
  background: var(--setup-surface);
  font: inherit;
  outline: none;
}

input:focus {
  border-color: var(--setup-accent);
  box-shadow: 0 0 0 3px rgb(16 185 129 / 14%);
}

.server-hint,
.server-error {
  margin: 9px 0 0;
  font-size: 13px;
  line-height: 1.5;
}

.server-hint {
  color: var(--setup-text-muted);
}

.server-error {
  color: #c9364f;
}

.server-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}

button {
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 11px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: .6;
}

button:focus-visible,
input:focus-visible {
  outline: 3px solid rgb(16 185 129 / 22%);
  outline-offset: 2px;
}

.primary {
  color: #fff;
  background: var(--setup-accent);
  box-shadow: 0 8px 18px rgb(16 185 129 / 22%);
}

.primary:not(:disabled):hover {
  background: var(--setup-accent-hover);
}

.secondary {
  border-color: var(--setup-border);
  color: var(--setup-text-secondary);
  background: var(--setup-surface-muted);
}

.server-switch {
  position: fixed;
  z-index: 10000;
  right: 18px;
  bottom: 18px;
  padding: 9px 14px;
  color: #fff;
  background: rgb(18 25 39 / 76%);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 28px rgb(0 0 0 / 20%);
}

@media (max-width: 560px) {
  .server-setup {
    padding: 18px;
  }

  .server-card {
    padding: 28px 22px;
  }

  .server-actions {
    flex-direction: column-reverse;
  }

  .server-actions button {
    width: 100%;
  }
}

@media (prefers-color-scheme: dark) {
  .server-setup {
    --setup-page: #020617;
    --setup-surface: rgb(15 23 42 / 68%);
    --setup-surface-muted: rgb(30 41 59 / 88%);
    --setup-border: rgb(148 163 184 / 20%);
    --setup-text: #f8fafc;
    --setup-text-secondary: #cbd5e1;
    --setup-text-muted: #94a3b8;
  }
}
</style>
