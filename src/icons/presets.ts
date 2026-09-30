export type IconPresetCategory = 'popular' | 'development' | 'productivity' | 'social' | 'entertainment'

export interface IconPreset {
  id: string
  title: string
  url: string
  mark: string
  color: string
  category: IconPresetCategory
  sprite?: string
  aliases?: readonly string[]
}

/** Bundled marks keep the first paint useful even when a site's favicon is unavailable. */
export const ICON_PRESETS: readonly IconPreset[] = [
  { id: 'baidu', title: '百度', url: 'https://www.baidu.com', mark: '百', color: '#315bd6', category: 'popular' },
  { id: 'google', title: 'Google', url: 'https://www.google.com', mark: 'G', color: '#ffffff', category: 'popular' },
  { id: 'bing', title: 'Bing', url: 'https://www.bing.com', mark: 'B', color: '#0c827b', category: 'popular' },
  { id: 'github', title: 'GitHub', url: 'https://github.com', mark: 'GH', color: '#303640', category: 'popular', sprite: 'mdi-github' },
  { id: 'bilibili', title: '哔哩哔哩', url: 'https://www.bilibili.com', mark: 'B', color: '#ed6a9a', category: 'popular', sprite: 'ri-bilibili-fill' },
  { id: 'youtube', title: 'YouTube', url: 'https://www.youtube.com', mark: '▶', color: '#ed4040', category: 'popular', sprite: 'ri-youtube-fill' },
  { id: 'chatgpt', title: 'ChatGPT', url: 'https://chatgpt.com', mark: 'AI', color: '#16836c', category: 'popular', sprite: 'mdi-robot' },
  { id: 'zhihu', title: '知乎', url: 'https://www.zhihu.com', mark: '知', color: '#2878e6', category: 'popular' },
  { id: 'weibo', title: '微博', url: 'https://weibo.com', mark: '微', color: '#e74d47', category: 'popular' },
  { id: 'xiaohongshu', title: '小红书', url: 'https://www.xiaohongshu.com', mark: '小红', color: '#e4484a', category: 'popular' },

  { id: 'cloudflare', title: 'Cloudflare', url: 'https://dash.cloudflare.com', mark: 'CF', color: '#ee7623', category: 'development', aliases: ['cloudflare.com'] },
  { id: 'docker', title: 'Docker Hub', url: 'https://hub.docker.com', mark: 'D', color: '#2675db', category: 'development', sprite: 'mdi-docker', aliases: ['docker.com'] },
  { id: 'v2ex', title: 'V2EX', url: 'https://www.v2ex.com', mark: 'V2', color: '#4a5e72', category: 'development', sprite: 'mdi-code-tags' },
  { id: 'npm', title: 'npm', url: 'https://www.npmjs.com', mark: 'npm', color: '#c83b38', category: 'development' },
  { id: 'mdn', title: 'MDN', url: 'https://developer.mozilla.org', mark: 'M', color: '#293243', category: 'development' },
  { id: 'stackoverflow', title: 'Stack Overflow', url: 'https://stackoverflow.com', mark: 'SO', color: '#ef8026', category: 'development' },
  { id: 'gitlab', title: 'GitLab', url: 'https://gitlab.com', mark: 'GL', color: '#d85a35', category: 'development' },
  { id: 'figma', title: 'Figma', url: 'https://www.figma.com', mark: 'F', color: '#8261cc', category: 'development' },
  { id: 'huggingface', title: 'Hugging Face', url: 'https://huggingface.co', mark: '🤗', color: '#dfaa35', category: 'development' },
  { id: 'codepen', title: 'CodePen', url: 'https://codepen.io', mark: 'CP', color: '#2f3945', category: 'development' },

  { id: 'claude', title: 'Claude', url: 'https://claude.ai', mark: 'C', color: '#bf8061', category: 'productivity' },
  { id: 'deepseek', title: 'DeepSeek', url: 'https://chat.deepseek.com', mark: 'DS', color: '#4673db', category: 'productivity', sprite: 'solar-cpu-bold', aliases: ['deepseek.com'] },
  { id: 'gemini', title: 'Gemini', url: 'https://gemini.google.com', mark: '✦', color: '#6487e6', category: 'productivity' },
  { id: 'notion', title: 'Notion', url: 'https://www.notion.so', mark: 'N', color: '#30343a', category: 'productivity' },
  { id: 'feishu', title: '飞书', url: 'https://www.feishu.cn', mark: '飞', color: '#4178ef', category: 'productivity' },
  { id: 'yuque', title: '语雀', url: 'https://www.yuque.com', mark: '语', color: '#22a57b', category: 'productivity' },
  { id: 'drive', title: 'Google Drive', url: 'https://drive.google.com', mark: '▲', color: '#2e9b6e', category: 'productivity' },
  { id: 'gmail', title: 'Gmail', url: 'https://mail.google.com', mark: 'M', color: '#d95855', category: 'productivity' },
  { id: 'outlook', title: 'Outlook', url: 'https://outlook.live.com', mark: 'O', color: '#2776c6', category: 'productivity' },

  { id: 'reddit', title: 'Reddit', url: 'https://www.reddit.com', mark: 'R', color: '#ec632e', category: 'social' },
  { id: 'discord', title: 'Discord', url: 'https://discord.com', mark: 'D', color: '#5968d8', category: 'social' },
  { id: 'telegram', title: 'Telegram', url: 'https://web.telegram.org', mark: 'T', color: '#2d9bd2', category: 'social', aliases: ['telegram.org', 't.me'] },
  { id: 'instagram', title: 'Instagram', url: 'https://www.instagram.com', mark: 'IG', color: '#ca4b95', category: 'social' },
  { id: 'facebook', title: 'Facebook', url: 'https://www.facebook.com', mark: 'f', color: '#3469bf', category: 'social' },
  { id: 'x', title: 'X', url: 'https://x.com', mark: '𝕏', color: '#2a3039', category: 'social', aliases: ['twitter.com'] },

  { id: 'netflix', title: 'Netflix', url: 'https://www.netflix.com', mark: 'N', color: '#d83333', category: 'entertainment' },
  { id: 'spotify', title: 'Spotify', url: 'https://open.spotify.com', mark: '♫', color: '#21a469', category: 'entertainment', aliases: ['spotify.com'] },
  { id: 'steam', title: 'Steam', url: 'https://store.steampowered.com', mark: 'S', color: '#344c68', category: 'entertainment', aliases: ['steampowered.com'] },
  { id: 'twitch', title: 'Twitch', url: 'https://www.twitch.tv', mark: 'T', color: '#8659d5', category: 'entertainment' },
  { id: 'douban', title: '豆瓣', url: 'https://www.douban.com', mark: '豆', color: '#418d63', category: 'entertainment' },
]

function hostname(value: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  }
  catch {
    return null
  }
}

const presetByHost = new Map<string, IconPreset>()
for (const preset of ICON_PRESETS) {
  for (const candidate of [preset.url, ...(preset.aliases ?? [])]) {
    const host = hostname(candidate)
    if (host)
      presetByHost.set(host, preset)
  }
}

export function findIconPresetForUrl(url?: string | null): IconPreset | null {
  const host = url && hostname(url)
  return host ? presetByHost.get(host) ?? null : null
}
