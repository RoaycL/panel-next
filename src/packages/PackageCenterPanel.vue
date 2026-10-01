<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { NButton, NInput, useDialog, useMessage } from 'naive-ui'
import { fetchPackage, inspectPackage, installPackage, installedPackages, packageLoadErrors, removePackage } from './manager'
import type { InstalledPackage, PackageKind } from './manager'

const props = defineProps<{ kind: PackageKind; beforeRemove?: (item: InstalledPackage) => Promise<void>; exportManifest?: unknown }>()
const emit = defineEmits<{ installed: [item: InstalledPackage] }>()
const dialog = useDialog()
const message = useMessage()
const url = ref('')
const busy = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const items = computed(() => installedPackages.value.filter(item => item.kind === props.kind))
const label = computed(() => props.kind === 'theme' ? '主题包' : '小组件包')

function errorMessage(error: unknown) {
  message.error(error instanceof Error ? error.message : String(error))
}

function review(candidate: InstalledPackage) {
  if (candidate.kind !== props.kind)
    throw new Error(`请安装${label.value}`)
  const updating = items.value.some(item => item.id === candidate.id)
  dialog.info({
    title: updating ? '确认更新' : '确认安装',
    content: () => h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '12px', lineHeight: '1.8' } }, `${candidate.name} · v${candidate.version}\n作者：${candidate.author || '未声明（身份未验证）'}\n来源：${candidate.source || '本地文件'}\nSHA-256：${candidate.digest}\n仅安装数据，不执行外部代码。发布者身份未经签名认证。`),
    positiveText: updating ? '更新并保存' : '安装并保存', negativeText: '取消',
    onPositiveClick: async () => {
      busy.value = true
      try {
        await installPackage(candidate)
        emit('installed', candidate)
        message.success(`${label.value}已保存，重新打开页面仍可使用`)
      }
      catch (error) {
        errorMessage(error)
        return false
      }
      finally { busy.value = false }
    },
  })
}

async function importFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return
  busy.value = true
  try {
    if (file.size > 2 * 1024 * 1024)
      throw new Error('安装包超过 2 MB 限制')
    review(inspectPackage(await file.text()))
  }
  catch (error) { errorMessage(error) }
  finally { busy.value = false }
}

async function remoteInstall(item?: InstalledPackage) {
  busy.value = true
  try {
    const candidate = await fetchPackage(item?.source || url.value.trim(), item)
    if (item && candidate.version === item.version) {
      message.success('已经是最新版本')
      return
    }
    review(candidate)
  }
  catch (error) { errorMessage(error) }
  finally { busy.value = false }
}

function deleteItem(item: InstalledPackage) {
  dialog.warning({
    title: `删除${label.value}？`,
    content: props.kind === 'theme' ? '若正在使用此主题，将先恢复默认主题。删除后可重新导入。' : '桌面上的该组件将显示不可用；布局数据会保留，重新安装可恢复。',
    positiveText: '删除', negativeText: '取消',
    onPositiveClick: async () => {
      busy.value = true
      try {
        await props.beforeRemove?.(item)
        await removePackage(item.kind, item.id)
        message.success(`${label.value}已删除，可通过原文件或地址重新安装`)
      }
      catch (error) { errorMessage(error); return false }
      finally { busy.value = false }
    },
  })
}

function exportPackage(manifest: unknown, name: string) {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = `${name.replace(/[^a-z0-9.-]/gi, '-')}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}
</script>

<template>
  <section class="package-center-panel">
    <div class="package-heading">
      <div><h4>{{ label }}管理</h4><p>本地保存 · 远程安装 · 手动确认更新</p></div>
      <NButton v-if="exportManifest" size="small" :disabled="busy" @click="exportPackage(exportManifest, 'panel-next-theme')">
        导出当前主题
      </NButton>
    </div>
    <p v-for="error in packageLoadErrors" :key="error" role="alert" class="package-error">
      {{ error }}
    </p>
    <div class="package-install-tools">
      <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="importFile">
      <NButton :disabled="busy" @click="fileInput?.click()">
        导入 JSON
      </NButton>
      <NInput v-model:value="url" placeholder="https://…/package.json" aria-label="远程安装包地址" :disabled="busy" />
      <NButton :loading="busy" :disabled="busy || !url.trim()" @click="remoteInstall()">
        远程安装
      </NButton>
    </div>
    <p class="package-hint">
      仅支持安全数据包，不运行外部脚本。Web 下载需发布站点允许跨域访问；扩展会请求该站点访问权限。
    </p>
    <div v-for="item in items" :key="item.id" class="installed-package">
      <div class="package-info">
        <strong>{{ item.name }} <small>v{{ item.version }}</small></strong><span>{{ item.author || '作者未声明' }} · {{ item.id }}</span><small :title="item.source || undefined">{{ item.source || '本地导入（无远程更新地址）' }}</small>
      </div>
      <div class="package-actions">
        <NButton size="tiny" :disabled="busy" @click="exportPackage(item.manifest, item.id)">
          导出
        </NButton>
        <NButton v-if="item.source" size="tiny" :disabled="busy" @click="remoteInstall(item)">
          检查更新
        </NButton>
        <NButton size="tiny" type="error" secondary :disabled="busy" @click="deleteItem(item)">
          删除
        </NButton>
      </div>
    </div>
    <p v-if="!items.length" class="package-hint">
      尚未安装第三方{{ label }}。安装后会出现在{{ kind === 'theme' ? '上方主题选择列表' : '小组件添加列表' }}中。
    </p>
  </section>
</template>

<style scoped>
.package-center-panel { padding:14px; border:1px solid var(--pn-color-border); border-radius:var(--pn-radius-medium); background:var(--pn-glass-panel); margin:12px 0; }
.package-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
h4 { margin:0; font-size:14px; } p { margin:6px 0 12px; }
.package-heading p, .package-hint { font-size:11px; color:var(--pn-color-text-muted); line-height:1.6; }
.package-install-tools { display:flex; gap:8px; align-items:center; }
.package-install-tools :deep(.n-input) { flex:1; min-width:0; }
.installed-package { display:flex; align-items:center; gap:12px; justify-content:space-between; border-top:1px solid var(--pn-color-border); padding:12px 0; }
.package-info { display:flex; flex-direction:column; gap:4px; min-width:0; font-size:12px; }
.package-info small, .package-info span { color:var(--pn-color-text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.package-actions { display:flex; gap:6px; flex-wrap:wrap; flex-shrink:0; }
.package-error { color:var(--pn-color-danger); }
@media(max-width:600px) { .package-install-tools { flex-wrap:wrap; } .package-install-tools :deep(.n-input) { flex-basis:100%; order:3; } .installed-package { align-items:flex-start; flex-direction:column; } }
</style>
