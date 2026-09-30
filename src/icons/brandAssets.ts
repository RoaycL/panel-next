const files = import.meta.glob<string>('../assets/brand-icons/*.{svg,png,ico,jpg,gif,webp}', { eager: true, query: '?url', import: 'default' })
const assets = new Map(Object.entries(files).map(([file, url]) => [file.split('/').pop()!.split('.')[0], url]))

export function getBundledBrandIcon(id: string): string {
  return assets.get(id) || ''
}
