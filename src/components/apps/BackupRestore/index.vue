<script setup lang="ts">
import { ref } from 'vue'
import type { UploadFileInfo } from 'naive-ui'
import { NAlert, NButton, NCard, NSpace, NText, NUpload, useDialog, useMessage } from 'naive-ui'
import { exportBackup, restoreBackup } from '@/api/system/backup'
import { SvgIcon } from '@/components/common'
import { t } from '@/locales'

const message = useMessage()
const dialog = useDialog()
const exporting = ref(false)
const restoring = ref(false)

async function handleExport() {
  exporting.value = true
  try {
    const blob = await exportBackup()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `sun-panel-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    message.success(t('apps.backupRestore.exportSuccess'))
  }
  catch (error) {
    message.error(error instanceof Error ? error.message : t('common.failed'))
  }
  finally {
    exporting.value = false
  }
}

function handleRestoreSelection(options: { file: UploadFileInfo }) {
  const file = options.file.file
  if (!file)
    return
  dialog.warning({
    title: t('apps.backupRestore.restoreConfirmTitle'),
    content: t('apps.backupRestore.restoreConfirmText'),
    positiveText: t('common.confirm'),
    negativeText: t('common.cancel'),
    onPositiveClick: () => handleRestore(file),
  })
}

async function handleRestore(file: File) {
  restoring.value = true
  try {
    const result = await restoreBackup(file)
    message.success(t('apps.backupRestore.restoreQueued', { name: result.preRestoreBackup }), {
      duration: 10000,
      closable: true,
    })
  }
  catch (error) {
    message.error(error instanceof Error ? error.message : t('common.failed'), {
      duration: 10000,
      closable: true,
    })
  }
  finally {
    restoring.value = false
  }
}
</script>

<template>
  <div class="p-3 h-full bg-slate-100 dark:bg-zinc-900">
    <NAlert type="warning" :bordered="false" class="mb-3">
      {{ $t('apps.backupRestore.warning') }}
    </NAlert>
    <NSpace vertical size="large">
      <NCard :title="$t('apps.backupRestore.exportTitle')" size="small">
        <NText depth="3">
          {{ $t('apps.backupRestore.exportDescription') }}
        </NText>
        <div class="mt-4">
          <NButton type="primary" :loading="exporting" @click="handleExport">
            <template #icon>
              <SvgIcon icon="fa6-solid-file-export" />
            </template>
            {{ $t('apps.backupRestore.exportButton') }}
          </NButton>
        </div>
      </NCard>

      <NCard :title="$t('apps.backupRestore.restoreTitle')" size="small">
        <NText depth="3">
          {{ $t('apps.backupRestore.restoreDescription') }}
        </NText>
        <div class="mt-4">
          <NUpload
            accept=".zip,application/zip"
            :default-upload="false"
            :show-file-list="false"
            :disabled="restoring"
            @change="handleRestoreSelection"
          >
            <NButton type="warning" :loading="restoring">
              <template #icon>
                <SvgIcon icon="fa6-solid-file-import" />
              </template>
              {{ $t('apps.backupRestore.restoreButton') }}
            </NButton>
          </NUpload>
        </div>
      </NCard>
    </NSpace>
  </div>
</template>
