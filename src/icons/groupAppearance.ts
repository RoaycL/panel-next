export const GROUP_ICON_CATEGORIES = ['常用', '开发', '网络与设备', '办公学习', '影音娱乐', '生活出行', '财务购物'] as const
export const GROUP_ICON_PRESETS = [
  { icon: 'material-symbols-folder-outline', label: '文件夹' },
  { icon: 'mdi-code-tags', label: '开发' },
  { icon: 'mdi-web', label: '网站' },
  { icon: 'mdi-devices', label: '设备' },
  { icon: 'mdi-docker', label: '容器' },
  { icon: 'material-symbols-lan-outline-rounded', label: '网络' },
  { icon: 'panel-next-note', label: '笔记' },
  { icon: 'panel-next-calendar', label: '日历' },
  { icon: 'mdi-github', label: 'GitHub' },
  { icon: 'ri-youtube-fill', label: '视频' },
  { icon: 'ion-color-palette-outline', label: '设计' },
  { icon: 'mdi-shield-key-outline', label: '安全' },
].map(item => ({ ...item, category: '常用' }))

const extraGroups = [
  { category: '常用', icons: [['home-outline', '主页'], ['star-outline', '收藏'], ['heart-outline', '喜欢'], ['bookmark-outline', '书签'], ['apps', '应用'], ['magnify', '搜索'], ['cog-outline', '设置'], ['view-dashboard-outline', '仪表盘']] },
  { category: '开发', icons: [['code-braces', '代码'], ['console', '终端'], ['git', 'Git'], ['bug-outline', '调试'], ['api', '接口'], ['database-outline', '数据库'], ['language-python', 'Python'], ['language-javascript', 'JavaScript'], ['language-html5', 'HTML'], ['source-branch', '分支']] },
  { category: '网络与设备', icons: [['server', '服务器'], ['nas', 'NAS'], ['cloud-outline', '云服务'], ['wifi', '无线网络'], ['router-wireless', '路由器'], ['monitor', '电脑'], ['cellphone', '手机'], ['printer-outline', '打印机'], ['harddisk', '硬盘'], ['shield-lock-outline', '隐私']] },
  { category: '办公学习', icons: [['book-open-page-variant-outline', '阅读'], ['school-outline', '学习'], ['pencil-outline', '写作'], ['file-document-outline', '文档'], ['clipboard-check-outline', '待办'], ['briefcase-outline', '工作'], ['email-outline', '邮箱'], ['translate', '翻译'], ['calculator', '计算器'], ['lightbulb-outline', '灵感']] },
  { category: '影音娱乐', icons: [['music', '音乐'], ['headphones', '耳机'], ['movie-outline', '电影'], ['television', '电视'], ['gamepad-variant-outline', '游戏'], ['camera-outline', '摄影'], ['image-outline', '图片'], ['microphone-outline', '播客'], ['palette-outline', '绘画'], ['robot-outline', 'AI']] },
  { category: '生活出行', icons: [['airplane', '旅行'], ['train', '火车'], ['car-outline', '汽车'], ['map-marker-outline', '位置'], ['compass-outline', '探索'], ['weather-sunny', '天气'], ['coffee-outline', '咖啡'], ['food-outline', '美食'], ['run', '运动'], ['flower-outline', '生活']] },
  { category: '财务购物', icons: [['cart-outline', '购物'], ['wallet-outline', '钱包'], ['credit-card-outline', '银行卡'], ['cash', '现金'], ['chart-line', '行情'], ['chart-pie', '统计'], ['bank-outline', '银行'], ['gift-outline', '礼物'], ['store-outline', '商店'], ['tag-outline', '优惠']] },
]
for (const group of extraGroups)
  for (const [name, label] of group.icons)
    GROUP_ICON_PRESETS.push({ icon: `mdi-${name}`, label, category: group.category })

export function filterGroupIcons(category: string, query: string) {
  const keyword = query.trim().toLowerCase()
  return GROUP_ICON_PRESETS.filter(item => (category === '全部' || item.category === category)
    && (!keyword || `${item.label} ${item.icon} ${item.category}`.toLowerCase().includes(keyword)))
}

export interface GroupAppearance { mode: 'builtin' | 'text' | 'image'; value: string }

export function isGroupImageSource(value: string): boolean {
  if (!value || value.length > 240 || Array.from(value).some(char => char.charCodeAt(0) <= 32 || char === '\\'))
    return false
  if (value.startsWith('/') && !value.startsWith('//'))
    return true
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  }
  catch { return false }
}

/** Keep the existing string field and wire contract; no backend migration needed. */
export function decodeGroupAppearance(icon?: string): GroupAppearance {
  if (icon?.startsWith('group-text:')) {
    try {
      const value = decodeURIComponent(icon.slice(11))
      if (value.trim() && Array.from(value).length <= 2)
        return { mode: 'text', value }
    }
    catch { /* Invalid encoded text falls back to the folder. */ }
  }
  else if (icon?.startsWith('group-image:') && isGroupImageSource(icon.slice(12))) {
    return { mode: 'image', value: icon.slice(12) }
  }
  else if (icon && !icon.startsWith('group-') && /^[a-z][a-z0-9-]*(?::[a-z0-9-]+)?$/i.test(icon)) {
    const normalized = icon.replace(':', '-')
    return { mode: 'builtin', value: GROUP_ICON_PRESETS.some(item => item.icon === normalized) ? normalized : icon }
  }
  return { mode: 'builtin', value: 'material-symbols-folder-outline' }
}

export function encodeGroupAppearance(appearance: GroupAppearance): string {
  if (appearance.mode === 'text') {
    const value = appearance.value.trim()
    if (!value || Array.from(value).length > 2)
      throw new Error('文字标记请输入 1–2 个字符')
    return `group-text:${encodeURIComponent(value)}`
  }
  if (appearance.mode === 'image') {
    if (!isGroupImageSource(appearance.value))
      throw new Error('图片地址无效或过长，请重新上传或选择图库图片')
    return `group-image:${appearance.value}`
  }
  if (!/^[a-z][a-z0-9-]*(?::[a-z0-9-]+)?$/i.test(appearance.value))
    throw new Error('请选择有效的内置图标')
  return appearance.value
}
