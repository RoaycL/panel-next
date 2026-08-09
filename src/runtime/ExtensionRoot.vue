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
      <img class="server-logo" src="/logo.png" alt="Panel Next">
      <p class="server-eyebrow">
        PANEL NEXT
      </p>
      <h1>{{ configuredOrigin ? '切换服务器' : '连接你的服务器' }}</h1>
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
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px;
  color: #172033;
  background:
    radial-gradient(circle at 15% 10%, rgb(90 178 255 / 26%), transparent 38%),
    radial-gradient(circle at 85% 85%, rgb(121 95 255 / 22%), transparent 38%),
    #f4f7fb;
}

.server-card {
  width: min(100%, 480px);
  padding: 40px;
  border: 1px solid rgb(23 32 51 / 8%);
  border-radius: 24px;
  background: rgb(255 255 255 / 92%);
  box-shadow: 0 24px 80px rgb(31 47 78 / 16%);
}

.server-logo {
  width: 56px;
  height: 56px;
  border-radius: 14px;
}

.server-eyebrow {
  margin: 20px 0 8px;
  color: #376cf6;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .16em;
}

h1 {
  margin: 0;
  font-size: 30px;
  line-height: 1.25;
}

.server-description {
  margin: 14px 0 28px;
  color: #667085;
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
  border: 1px solid #cfd6e4;
  border-radius: 10px;
  color: inherit;
  background: #fff;
  font: inherit;
  outline: none;
}

input:focus {
  border-color: #376cf6;
  box-shadow: 0 0 0 3px rgb(55 108 246 / 14%);
}

.server-hint,
.server-error {
  margin: 9px 0 0;
  font-size: 13px;
  line-height: 1.5;
}

.server-hint {
  color: #7a8498;
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
  border: 0;
  border-radius: 10px;
  padding: 11px 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

button:disabled {
  cursor: wait;
  opacity: .6;
}

.primary {
  color: #fff;
  background: #376cf6;
}

.secondary {
  color: #39445a;
  background: #edf1f7;
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
}
</style>
