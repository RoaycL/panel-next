<script setup lang="ts">
import { NGrid, NGridItem, NImage, NImageGroup, NSelect, NSpin, NTag } from 'naive-ui'
import { onMounted, ref, watch } from 'vue'
import { getList as getPrivateList } from '@/api/system/file'
import { getList as getPublicList } from '@/api/system/publicFile'
import { t } from '@/locales'

const props = withDefaults(defineProps<{
  type?: string // icon/wallpaper/other/all
}>(), {
  type: 'all',
})

const emit = defineEmits<{
  (e: 'select', url: string): void
}>()

void props

const imageList = ref<File.Info[]>([])
const loading = ref(false)
const activeType = ref<string>('all')
const source = ref<'private' | 'public'>('private')

const sourceOptions = [
  { label: t('apps.uploadsFileManager.typeAll'), value: 'all' },
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
]

async function fetchImages() {
  loading.value = true
  const type = activeType.value === 'all' ? undefined : activeType.value
  try {
    if (source.value === 'private') {
      const { data } = await getPrivateList<Common.ListResponse<File.Info[]>>(type)
      imageList.value = data.list
    } else {
      const { data } = await getPublicList<Common.ListResponse<File.Info[]>>(type)
      imageList.value = data.list
    }
  } finally {
    loading.value = false
  }
}

function handleSelect(url: string) {
  emit('select', url)
}

watch(source, fetchImages)
onMounted(fetchImages)
</script>

<template>
  <div class="gallery-selector p-2 h-full overflow-auto">
    <NSpin v-show="loading" size="small" />

    <div class="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <div class="flex gap-2">
        <button
          type="button"
          class="px-3 py-1 rounded-full text-xs border"
          :class="source === 'private' ? 'bg-blue-500 text-white border-blue-500' : 'bg-transparent text-slate-500 border-slate-300 dark:border-zinc-600'"
          @click="source = 'private'"
        >
          {{ $t('apps.uploadsFileManager.alertText').includes('文件') ? '个人图库' : 'Private Gallery' }}
        </button>
        <button
          type="button"
          class="px-3 py-1 rounded-full text-xs border"
          :class="source === 'public' ? 'bg-blue-500 text-white border-blue-500' : 'bg-transparent text-slate-500 border-slate-300 dark:border-zinc-600'"
          @click="source = 'public'"
        >
          {{ $t('apps.publicGallery.appName') }}
        </button>
      </div>
      <NSelect
        v-model:value="activeType"
        :options="sourceOptions"
        size="small"
        style="width: 140px"
        @update-value="fetchImages"
      />
    </div>

    <div v-if="!loading && imageList.length === 0" class="text-center text-slate-400 py-8">
      {{ t('apps.uploadsFileManager.nothingText') }}
    </div>

    <NImageGroup v-else>
      <NGrid cols="2 300:2 600:4 900:6 1100:9" :x-gap="5" :y-gap="5">
        <NGridItem v-for="item in imageList" :key="item.id">
          <div
            class="cursor-pointer rounded-lg overflow-hidden border hover:border-primary transition-colors border-transparent hover:border-blue-500"
            @click="handleSelect(item.src)"
          >
            <NImage
              :src="item.src"
              :lazy="true"
              object-fit="contain"
              height="80"
              class="w-full"
            />
            <div class="p-1 text-xs truncate text-center bg-slate-100 dark:bg-zinc-800">
              {{ item.fileName }}
            </div>
            <NTag
              size="tiny"
              type="info"
              class="absolute top-1 left-1"
              style="background: rgba(0,0,0,0.6); color: white; border: none;"
            >
              {{ item.type || 'other' }}
            </NTag>
          </div>
        </NGridItem>
      </NGrid>
    </NImageGroup>
  </div>
</template>

<style scoped>
.gallery-selector {
  background: white;
  min-height: 300px;
}
.dark .gallery-selector {
  background: #1a1a1a;
}
</style>
