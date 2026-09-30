<script setup lang="ts">
import { NAlert, NButton, NDataTable, NEmpty, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { computed, h, onMounted, ref } from 'vue'
import { getSessionList, revokeSession, revokeAllSessions } from '@/api/system/userSession'
import type { SessionInfo } from '@/api/system/userSession'
import { t } from '@/locales'
import { timeFormat } from '@/utils/cmn'

const { embedded = false } = defineProps<{ embedded?: boolean }>()

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const sessions = ref<SessionInfo[]>([])
const lastUpdatedAt = ref<Date | null>(null)
const revocableSessionCount = computed(() => sessions.value.filter(session => !session.current).length)
const extensionSessionCount = computed(() => sessions.value.filter(session => session.clientType === 'chrome_extension').length)

const columns: DataTableColumns<SessionInfo> = [
  {
    title: t('adminSettingUsers.deviceName'),
    key: 'deviceName',
    render(row) {
      const elements: any[] = [h('span', row.deviceName || t('adminSettingUsers.unknownDevice'))]
      if (row.current) {
        elements.push(h(NTag, {
          size: 'small',
          type: 'success',
          class: 'ml-2',
          bordered: false,
        }, { default: () => t('adminSettingUsers.currentSession') }))
      }
      return h('div', { class: 'flex items-center' }, elements)
    },
  },
  {
    title: t('adminSettingUsers.clientType'),
    key: 'clientType',
    render(row) {
      const label = row.clientType === 'web'
        ? t('adminSettingUsers.clientWeb')
        : t('adminSettingUsers.clientExtension')
      return h(NTag, { size: 'small', bordered: false }, { default: () => label })
    },
  },
  {
    title: t('adminSettingUsers.createdAt'),
    key: 'createdAt',
    render(row) {
      return timeFormat(row.createdAt)
    },
  },
  {
    title: t('adminSettingUsers.lastActiveAt'),
    key: 'lastActiveAt',
    render(row) {
      return timeFormat(row.lastActiveAt)
    },
  },
  {
    title: t('adminSettingUsers.refreshExpiresAt'),
    key: 'refreshExpiresAt',
    render(row) {
      if (row.clientType === 'chrome_extension' && new Date(row.refreshExpiresAt).getUTCFullYear() >= 9999)
        return t('adminSettingUsers.neverExpires')
      return timeFormat(row.refreshExpiresAt)
    },
  },
  {
    title: t('common.action'),
    key: 'action',
    render(row) {
      if (row.current)
        return h('span', { class: 'text-slate-400 text-xs' }, t('adminSettingUsers.cannotRevokeCurrent'))
      return h(NButton, {
        size: 'small',
        type: 'error',
        tertiary: true,
        onClick: () => handleRevoke(row.id),
      }, { default: () => t('adminSettingUsers.revoke') })
    },
  },
]

async function fetchSessions() {
  loading.value = true
  try {
    const { code, data } = await getSessionList<{ list: SessionInfo[] }>()
    if (code === 0 && data?.list) {
      sessions.value = data.list
      lastUpdatedAt.value = new Date()
    }
    else {
      message.error('加载设备会话失败')
    }
  }
  catch (error) {
    message.error(error instanceof Error ? error.message : t('common.serverError'))
  }
  finally {
    loading.value = false
  }
}

async function handleRevoke(id: string) {
  dialog.warning({
    title: t('common.warning'),
    content: t('adminSettingUsers.revokeConfirm'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const { code } = await revokeSession(id)
      if (code === 0) {
        message.success(t('common.success'))
        fetchSessions()
      }
    },
  })
}

async function handleRevokeAll() {
  dialog.warning({
    title: t('common.warning'),
    content: t('adminSettingUsers.revokeAllConfirm'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      const { code } = await revokeAllSessions()
      if (code === 0) {
        message.success(t('common.success'))
        fetchSessions()
      }
    },
  })
}

onMounted(fetchSessions)
</script>

<template>
  <div class="pn-app-page" :class="embedded ? 'embedded-session-center' : 'overflow-auto pt-2'">
    <NAlert type="info" :bordered="false">
      {{ $t('adminSettingUsers.sessionsAlertText') }}
    </NAlert>
    <div class="session-summary-grid">
      <div><b>{{ sessions.length }}</b><span>全部会话</span></div>
      <div><b>{{ extensionSessionCount }}</b><span>扩展设备</span></div>
      <div><b>{{ revocableSessionCount }}</b><span>可撤销会话</span></div>
    </div>
    <div class="pn-app-toolbar">
      <NButton size="small" type="primary" ghost :loading="loading" @click="fetchSessions">
        {{ $t('common.refresh') }}
      </NButton>
      <NButton size="small" type="error" ghost :disabled="revocableSessionCount === 0" @click="handleRevokeAll">
        {{ $t('adminSettingUsers.revokeAll') }}
      </NButton>
      <small v-if="lastUpdatedAt" class="pn-app-muted ml-auto">更新于 {{ lastUpdatedAt.toLocaleTimeString() }}</small>
    </div>
    <NDataTable
      v-if="sessions.length || loading"
      :columns="columns"
      :data="sessions"
      :bordered="false"
      :loading="loading"
      :scroll-x="860"
      size="small"
    />
    <NEmpty v-else size="small" description="暂无设备会话" class="pn-app-empty" />
  </div>
</template>

<style scoped>
.embedded-session-center {
  min-width: 0;
  padding-top: 12px;
  overflow: hidden;
}

.session-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.session-summary-grid > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 10px 12px;
  border: 1px solid var(--pn-color-border, rgba(148, 163, 184, .24));
  border-radius: var(--pn-radius-medium, 12px);
  background: var(--pn-color-surface, #fff);
}

.session-summary-grid b { color: var(--pn-color-text-primary, #0f172a); font-size: 16px; }
.session-summary-grid span { margin-top: 2px; color: var(--pn-color-text-muted, #64748b); font-size: 10px; }

@media (max-width: 560px) {
  .session-summary-grid { grid-template-columns: 1fr; }
}
</style>
