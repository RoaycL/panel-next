<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue'
import { VueDraggable } from 'vue-draggable-plus'
import { NAvatar, NButton, NCheckbox, NInput, NSwitch, useMessage } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useModuleConfig } from '@/store/modules'
import { useAuthStore } from '@/store'
import { VisitMode } from '@/enums/auth'
import { getRuntime } from '@/runtime'
import SearchHistoryPanel from '@/components/common/SearchHistoryPanel.vue'
import { addSearchHistory, normalizeSearchHistory } from '@/runtime/searchHistory'

import SvgSrcBaidu from '@/assets/search_engine_svg/baidu.svg'
import SvgSrcBing from '@/assets/search_engine_svg/bing.svg'
import SvgSrcGoogle from '@/assets/search_engine_svg/google.svg'

withDefaults(defineProps<{
  background?: string
  textColor?: string
}>(), {
  // 默认值跟随主题 Search/Widget Token（无 ThemeProvider 时回退原视觉）；
  // Search Variant 通过 --pn-search-* 变量重映射形态。
  background: 'var(--pn-search-background, var(--pn-widget-background, #2a2a2a6b))',
  textColor: 'var(--pn-search-text-color, var(--pn-widget-text-color, white))',
})

const emits = defineEmits(['itemSearch'])

interface State {
  currentSearchEngine: DeskModule.SearchBox.SearchEngine
  searchEngineList: DeskModule.SearchBox.SearchEngine[]
  newWindowOpen: boolean
}

const moduleConfigName = 'deskModuleSearchBox'
const moduleConfig = useModuleConfig()
const authStore = useAuthStore()
const runtime = getRuntime()
const searchTerm = ref('')
const isFocused = ref(false)
const searchSelectListShow = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const historyPanel = ref<InstanceType<typeof SearchHistoryPanel> | null>(null)
const historyId = useId()
const historyDismissed = ref(false)
const historyEnabled = ref(true)
const history = ref<string[]>([])
const message = useMessage()
const historyKey = computed(() => `PANEL_NEXT_SEARCH_HISTORY_V1:${encodeURIComponent(runtime.getServerOrigin() || 'local')}:${authStore.userInfo?.id ?? 'guest'}`)
watch(historyKey, key => {
  try {
    const saved = JSON.parse(runtime.storage.getItem(key) || '{}')
    historyEnabled.value = saved.enabled !== false
    history.value = historyEnabled.value ? normalizeSearchHistory(saved.entries) : []
  }
  catch { history.value = []; historyEnabled.value = true }
}, { immediate: true })
function saveHistory() {
  try { runtime.storage.setItem(historyKey.value, JSON.stringify({ enabled: historyEnabled.value, entries: history.value })) }
  catch { message.warning('搜索历史保存失败，请检查浏览器存储权限') }
}
function setHistoryEnabled(enabled: boolean) {
  historyEnabled.value = enabled
  if (!enabled) history.value = []
  saveHistory()
}
function clearHistory() { history.value = []; saveHistory() }
function removeHistory(query: string) { history.value = history.value.filter(item => item !== query); saveHistory() }
function selectHistory(query: string) { searchTerm.value = query; searchInputRef.value?.focus(); historyDismissed.value = true }
function dismissHistory() { searchInputRef.value?.focus(); historyDismissed.value = true }
function onFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) isFocused.value = false
}
const defaultSearchEngineList = ref<DeskModule.SearchBox.SearchEngine[]>([
  {
    iconSrc: SvgSrcGoogle,
    title: 'Google',
    url: 'https://www.google.com/search?q=%s',
  },
  {
    iconSrc: SvgSrcBaidu,
    title: 'Baidu',
    url: 'https://www.baidu.com/s?wd=%s',
  },
  {
    iconSrc: SvgSrcBing,
    title: 'Bing',
    url: 'https://www.bing.com/search?q=%s',
  },
])

const defaultState: State = {
  currentSearchEngine: defaultSearchEngineList.value[0],
  searchEngineList: defaultSearchEngineList.value,
  newWindowOpen: false,
}

const state = ref<State>({ ...defaultState })

// SEARCH-01: 自定义搜索引擎
const customEngineName = ref('')
const customEngineUrl = ref('')

function addCustomEngine() {
  const name = customEngineName.value.trim()
  const url = customEngineUrl.value.trim()
  if (!name || !url)
    return
  state.value.searchEngineList.push({
    iconSrc: '',
    title: name,
    url: url.includes('%s') ? url : `${url}%s`,
  })
  if (authStore.visitMode !== VisitMode.VISIT_MODE_PUBLIC)
    moduleConfig.saveToCloud(moduleConfigName, state.value)
  customEngineName.value = ''
  customEngineUrl.value = ''
}

const onFocus = (): void => {
  isFocused.value = true
  historyDismissed.value = false
}

function handleEngineClick() {
  // SEARCH-02: 公开访问模式允许临时切换引擎但不显示设置
  searchSelectListShow.value = !searchSelectListShow.value
}

function handleEngineUpdate(engine: DeskModule.SearchBox.SearchEngine) {
  state.value.currentSearchEngine = engine
  // SEARCH-02: 公开访问模式不持久化，刷新后恢复默认
  if (authStore.visitMode !== VisitMode.VISIT_MODE_PUBLIC)
    moduleConfig.saveToCloud(moduleConfigName, state.value)
  searchSelectListShow.value = false
}

function handleSearchClick() {
  if (!searchTerm.value.trim()) return
  if (historyEnabled.value) { history.value = addSearchHistory(history.value, searchTerm.value); saveHistory() }
  historyDismissed.value = true
  const url = state.value.currentSearchEngine.url
  const keyword = searchTerm
  // 如果网址中存在 %s，则直接替换为关键字
  const fullUrl = replaceOrAppendKeywordToUrl(url, keyword.value)
  handleClearSearchTerm()
  if (state.value.newWindowOpen)
    runtime.openUrl(fullUrl, 'tab')
  else
    runtime.openUrl(fullUrl, 'current')
}

function replaceOrAppendKeywordToUrl(url: string, keyword: string) {
  // 如果网址中存在 %s，则直接替换为关键字
  if (url.includes('%s'))
    return url.replace('%s', encodeURIComponent(keyword))

  // 如果网址中不存在 %s，则将关键字追加到末尾
  return url + (keyword ? `${encodeURIComponent(keyword)}` : '')
}

const handleItemSearch = () => {
  emits('itemSearch', searchTerm.value)
}

function handleClearSearchTerm() {
  searchTerm.value = ''
  emits('itemSearch', searchTerm.value)
}

onMounted(() => {
  // 云端模块配置不可达（扩展尚未配置服务端的 404/网络错误等）时静默回退到本地
  // 默认搜索引擎，避免 getValueByNameFromCloud 的拒绝变成未捕获的 Promise 拒绝。
  moduleConfig.getValueByNameFromCloud<State>('deskModuleSearchBox')
    .then(({ code, data }) => {
      if (code === 0)
        state.value = data || defaultState
      else
        state.value = defaultState
    })
    .catch(() => {
      state.value = { ...defaultState }
    })

  // SEARCH-03: 按 / 快速聚焦搜索框，不干扰编辑输入框
  document.addEventListener('keydown', handleSlashKey)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleSlashKey)
})

function handleSlashKey(e: KeyboardEvent) {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey)
    return
  const target = e.target as HTMLElement
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
    return
  e.preventDefault()
  searchInputRef.value?.focus()
}
</script>

<template>
  <div class="search-box w-full" @focusin="isFocused = true" @focusout="onFocusOut">
    <div class="search-container flex rounded-2xl items-center justify-center text-white w-full" :style="{ background, color: textColor }" :class="{ focused: isFocused }">
      <div class="search-box-btn-engine w-[40px] flex justify-center cursor-pointer" @click="handleEngineClick">
        <NAvatar :src="state.currentSearchEngine.iconSrc" style="background-color: transparent;" :size="20" />
      </div>

      <input ref="searchInputRef" v-model="searchTerm" :placeholder="$t('deskModule.searchBox.inputPlaceholder')" aria-label="搜索网页或输入网址" :aria-controls="historyId" :aria-expanded="historyEnabled && isFocused && !historyDismissed && history.length > 0" autocomplete="off" :maxlength="200" @focus="onFocus" @click="historyDismissed = false" @input="historyDismissed = false; handleItemSearch()" @keydown.enter="!$event.isComposing && handleSearchClick()" @keydown.down.prevent="historyPanel?.focusEntry()" @keydown.up.prevent="historyPanel?.focusEntry(true)" @keydown.esc.prevent="dismissHistory">

      <div v-if="searchTerm !== ''" class="search-box-btn-clear w-[25px] mr-[10px] flex justify-center cursor-pointer" @click="handleClearSearchTerm">
        <SvgIcon style="width: 20px;height: 20px;" icon="line-md:close-small" />
      </div>
      <div class="search-box-btn-search w-[25px] flex justify-center cursor-pointer" @click="handleSearchClick">
        <SvgIcon style="width: 20px;height: 20px;" icon="iconamoon:search-fill" />
      </div>
    </div>

    <SearchHistoryPanel :id="historyId" ref="historyPanel" :entries="history" :query="searchTerm" :visible="historyEnabled && isFocused && !historyDismissed && !searchSelectListShow" @select="selectHistory" @remove="removeHistory" @clear="clearHistory" @close="dismissHistory" />

    <!-- 搜索引擎选择 -->
    <div v-if="searchSelectListShow" class="w-full mt-[10px] rounded-xl p-[10px]" :style="{ background }">
      <div class="flex items-center flex-wrap gap-[10px]">
        <VueDraggable
          v-model="state.searchEngineList"
          :animation="200"
          class="flex items-center flex-wrap gap-[10px]"
          @end="authStore.visitMode !== VisitMode.VISIT_MODE_PUBLIC && moduleConfig.saveToCloud(moduleConfigName, state)"
        >
          <div
            v-for="item, index in state.searchEngineList"
            :key="index"
            :title="item.title"
            class="w-[40px] h-[40px] cursor-pointer bg-[#ffffff] flex items-center justify-center rounded-xl"
            @click="handleEngineUpdate(item)"
          >
            <NAvatar :src="item.iconSrc" style="background-color: transparent;" :size="20" />
          </div>
        </VueDraggable>
        <!-- SEARCH-01: 自定义搜索引擎（非公开模式） -->
        <div v-if="authStore.visitMode !== VisitMode.VISIT_MODE_PUBLIC" class="flex items-center gap-[5px]">
          <NInput v-model:value="customEngineName" size="tiny" :placeholder="$t('deskModule.searchBox.customEngineName')" style="width: 80px;" />
          <NInput v-model:value="customEngineUrl" size="tiny" :placeholder="$t('deskModule.searchBox.customEngineUrl')" style="width: 120px;" />
          <NButton size="tiny" @click="addCustomEngine">
            {{ $t('common.add') }}
          </NButton>
        </div>
      </div>

      <div class="mt-[10px]">
        <label class="search-history-setting"><span>保留搜索历史<small>点击输入框查看；关闭会清除本机历史</small></span><NSwitch :value="historyEnabled" aria-label="保留搜索历史" @update:value="setHistoryEnabled" /></label>
        <NCheckbox v-model:checked="state.newWindowOpen" @update:checked="moduleConfig.saveToCloud(moduleConfigName, state)">
          <span :style="{ color: textColor }">
            {{ $t('deskModule.searchBox.openWithNewOpen') }}
          </span>
        </NCheckbox>
      </div>
    </div>
  </div>
</template>

<style scoped>
.search-box { position: relative; }
.search-history-setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 4px; color: var(--pn-color-text-primary); font-size: 13px; }
.search-history-setting small { display: block; margin-top: 4px; font-size: 11px; color: var(--pn-color-text-secondary); }
.search-container {
  border: 1px solid var(--pn-search-border, var(--pn-widget-border, rgb(204 204 204 / 60%)));
  border-radius: var(--pn-search-radius, var(--pn-radius-large, 16px));
  transition: box-shadow 0.5s,backdrop-filter 0.5s;
  padding: 2px 10px;
  backdrop-filter:blur(2px)
}

.focused, .search-container:hover {
  box-shadow: 0px 0px 30px -5px rgba(41, 41, 41, 0.45);
  -webkit-box-shadow: 0px 0px 30px -5px rgba(0, 0, 0, 0.45);
  -moz-box-shadow: 0px 0px 30px -5px rgba(0, 0, 0, 0.45);
  backdrop-filter:blur(5px)
}

.before {
  left: 10px;
}

.after {
  right: 10px;
}

input {
  background-color: transparent;
  box-sizing: border-box;
  width: 100%;
  height: 40px;
  padding: 10px 5px;
  min-width: 0;
  border: 0 !important;
  outline: 0 !important;
  box-shadow: none !important;
  border-radius: 0 !important;
  appearance: none;
  -webkit-appearance: none;
  color: inherit;
  font: inherit;
  font-size: 15px;
}
</style>
