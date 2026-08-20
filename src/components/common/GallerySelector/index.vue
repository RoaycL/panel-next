<script setup lang="ts">
import { NGrid, NGridItem, NImage, NImageGroup, NSpin, NTag } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { getList } from '@/api/system/file'
import { t } from '@/locales'

interface Props {
  type?: string // icon/wallpaper/other/all
}

const props = withDefaults(defineProps<Props>(), {
  type: 'all',
})

const emit = defineEmits<{
  (e: 'select', url: string): void
  (e: 'update:type', type: string): void
}>()

const imageList = ref<File.Info[]>([])
const loading = ref(false)
const activeType = ref<string>('all')

const filteredList = computed(() => {
  if (activeType.value === 'all')
    return imageList.value
  return imageList.value.filter(item => item.type === activeType.value)
})

async function fetchImages() {
  loading.value = true
  const type = activeType.value === 'all' ? undefined : activeType.value
  const { data } = await getList<Common.ListResponse<File.Info[]>>(type)
  imageList.value = data.list
  loading.value = false
}

function handleSelect(url: string) {
  emit('select', url)
}

const typeOptions = [
  { label: t('apps.uploadsFileManager.typeAll'), value: 'all' },
  { label: t('apps.uploadsFileManager.typeIcon'), value: 'icon' },
  { label: t('apps.uploadsFileManager.typeWallpaper'), value: 'wallpaper' },
  { label: t('apps.uploadsFileManager.typeOther'), value: 'other' },
]

onMounted(fetchImages)
</script>

<template>
  <div class="gallery-selector p-2 h-full overflow-auto">
    <NSpin v-show="loading" size="small" />
    
    <div v-if="!loading && imageList.length === 0" class="text-center text-slate-400 py-8">
      {{ t('apps.uploadsFileManager.nothingText') }}
    </div>

    <div v-else class="flex items-center justify-between mb-2 gap-2 flex-wrap">
      <NSelect
        v-model:value="activeType"
        :options="typeOptions"
        size="small"
        style="width: 140px"
        @update-value="fetchImages"
      />
    </div>

    <NImageGroup>
      <NGrid cols="2 300:2 600:4 900:6 1100:9" :x-gap="5" :y-gap="5">
        <NGridItem v-for="item in filteredList" :key="item.id">
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
