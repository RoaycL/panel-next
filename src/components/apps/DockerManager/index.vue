<script setup lang="ts">
import { NAlert, NButton, NDataTable, NTag, NSpin, useDialog, useMessage } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { h, onMounted, ref } from 'vue'
import { getDockerStatus, getDockerList, startContainer, stopContainer, restartContainer  } from '@/api/system/docker'
import type {DockerContainer} from '@/api/system/docker';
import { useAuthStore } from '@/store'
import { t } from '@/locales'

const message = useMessage()
const authStore = useAuthStore()
const dialog = useDialog()
const loading = ref(false)
const containers = ref<DockerContainer[]>([])
const dockerAvailable = ref(false)
const isAdmin = authStore.userInfo?.role === 1

const columns: DataTableColumns<DockerContainer> = [
  {
    title: t('apps.dockerManager.name'),
    key: 'name',
    render(row) {
      return h('span', { class: 'font-bold' }, row.name)
    },
  },
  {
    title: t('apps.dockerManager.image'),
    key: 'image',
    ellipsis: { tooltip: true },
  },
  {
    title: t('apps.dockerManager.status'),
    key: 'state',
    render(row) {
      const stateColors: Record<string, 'success' | 'error' | 'warning'> = {
        running: 'success',
        exited: 'error',
        paused: 'warning',
      }
      const type = stateColors[row.state] || 'default'
      return h(NTag, { size: 'small', type, bordered: false }, { default: () => row.status || row.state })
    },
  },
  {
    title: t('apps.dockerManager.ports'),
    key: 'ports',
    render(row) {
      if (!row.ports || row.ports.length === 0)
        return '-'
      return row.ports.map(p => `${p.ip || ''}:${p.publicPort || ''}->${p.privatePort}/${p.type}`).join(', ')
    },
  },
  {
    title: t('common.action'),
    key: 'action',
    render(row) {
      if (!isAdmin)
        return h('span', { class: 'text-slate-400 text-xs' }, t('apps.dockerManager.readonly'))

      const buttons: any[] = []

      if (row.state !== 'running') {
        buttons.push(h(NButton, {
          size: 'small',
          type: 'success',
          tertiary: true,
          onClick: () => handleAction('start', row),
        }, { default: () => t('apps.dockerManager.start') }))
      }

      if (row.state === 'running') {
        buttons.push(h(NButton, {
          size: 'small',
          type: 'warning',
          tertiary: true,
          onClick: () => handleAction('stop', row),
        }, { default: () => t('apps.dockerManager.stop') }))
      }

      buttons.push(h(NButton, {
        size: 'small',
        type: 'info',
        tertiary: true,
        onClick: () => handleAction('restart', row),
      }, { default: () => t('apps.dockerManager.restart') }))

      return h('div', { class: 'flex gap-2' }, buttons)
    },
  },
]

async function checkStatus() {
  const res = await getDockerStatus<{ available: boolean }>()
  dockerAvailable.value = res.code === 0 && res.data?.available
}

async function fetchContainers() {
  if (!dockerAvailable.value) {
    await checkStatus()
  }
  if (!dockerAvailable.value)
    return
  loading.value = true
  try {
    const res = await getDockerList<{ list: DockerContainer[]; count: number }>()
    if (res.code === 0 && res.data?.list)
      containers.value = res.data.list
  }
  finally {
    loading.value = false
  }
}

async function handleAction(action: 'start' | 'stop' | 'restart', container: DockerContainer) {
  dialog.warning({
    title: t('common.warning'),
    content: t(`apps.dockerManager.${action}Confirm`, { name: container.name }),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: async () => {
      try {
        const fn = action === 'start' ? startContainer : action === 'stop' ? stopContainer : restartContainer
        const { code, msg } = await fn(container.id)
        if (code === 0) {
          message.success(t('common.success'))
          fetchContainers()
        }
        else {
          message.error(`${t('common.failed')}:${msg}`)
        }
      }
      catch {
        message.error(t('common.failed'))
      }
    },
  })
}

onMounted(async () => {
  await checkStatus()
  if (dockerAvailable.value)
    fetchContainers()
})
</script>

<template>
  <div class="overflow-auto pt-2">
    <NAlert v-if="!dockerAvailable" type="warning" :bordered="false">
      {{ $t('apps.dockerManager.unavailable') }}
    </NAlert>
    <NAlert v-else type="info" :bordered="false">
      {{ $t('apps.dockerManager.alertText') }}
    </NAlert>

    <div class="my-[10px] flex gap-[10px]">
      <NButton size="small" type="primary" ghost :disabled="!dockerAvailable" @click="fetchContainers">
        {{ $t('common.refresh') }}
      </NButton>
    </div>

    <NSpin v-show="loading" size="small" />
    <NDataTable
      v-if="dockerAvailable"
      :columns="columns"
      :data="containers"
      :bordered="false"
      :loading="loading"
      size="small"
    />
  </div>
</template>
