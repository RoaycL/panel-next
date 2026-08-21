<script setup lang="ts">
import { NAlert, NButton, NDataTable, NTag, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h, onMounted, ref } from 'vue'
import { getSessionList, revokeSession, revokeAllSessions } from '@/api/system/userSession'
import type { SessionInfo } from '@/api/system/userSession'
import { t } from '@/locales'
import { timeFormat } from '@/utils/cmn'

const message = useMessage()
const dialog = useDialog()
const loading = ref(false)
const sessions = ref<SessionInfo[]>([])

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
    if (code === 0 && data?.list)
      sessions.value = data.list
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
  <div class="overflow-auto pt-2">
    <NAlert type="info" :bordered="false">
      {{ $t('adminSettingUsers.sessionsAlertText') }}
    </NAlert>
    <div class="my-[10px] flex gap-[10px]">
      <NButton size="small" type="primary" ghost @click="fetchSessions">
        {{ $t('common.refresh') }}
      </NButton>
      <NButton size="small" type="error" ghost @click="handleRevokeAll">
        {{ $t('adminSettingUsers.revokeAll') }}
      </NButton>
    </div>
    <NDataTable
      :columns="columns"
      :data="sessions"
      :bordered="false"
      :loading="loading"
      size="small"
    />
  </div>
</template>
