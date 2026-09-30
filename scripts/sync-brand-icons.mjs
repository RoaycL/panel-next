import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

// Run manually when updating bundled favicons. Never runs at extension startup.
const run = promisify(execFile)
const source = await fs.readFile(new URL('../src/icons/presets.ts', import.meta.url), 'utf8')
const sites = [...source.matchAll(/id: '([^']+)', title: '[^']+', url: '([^']+)'/g)].map(([, id, url]) => ({ id, url }))
const destination = path.resolve('src/assets/brand-icons')
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-brand-icons-'))
await fs.mkdir(destination, { recursive: true })
const previous = JSON.parse(await fs.readFile(path.join(destination, 'sources.json'), 'utf8').catch(() => '[]'))
const results = []
const officialOverrides = {
  chatgpt: 'https://images.ctfassets.net/j22is2dtoxu1/intercom-img-d177d076c9a5453052925143/49d5d812b0a6fcc20a14faa8c629d9fb/icon-ios-1024_401x.png?fm=webp&q=80&w=1024',
  npm: 'https://raw.githubusercontent.com/npm/logos/master/npm%20square/n.svg',
  codepen: 'https://blog.codepen.io/wp-content/uploads/2014/03/codepen-logo.svg',
}

async function download(url, file) {
  await run('curl', ['-fLsS', '--max-time', '18', '--max-filesize', '2097152', '--user-agent', 'Mozilla/5.0', '--output', file, url], { maxBuffer: 1024 })
  return fs.readFile(file)
}

function extension(bytes) {
  if (bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png'
  if (bytes.subarray(0, 4).toString('hex') === '00000100') return 'ico'
  if (bytes.subarray(0, 3).toString('hex') === 'ffd8ff') return 'jpg'
  if (bytes.subarray(0, 3).toString() === 'GIF') return 'gif'
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp'
  const svg = bytes.toString()
  if (/<svg\b/i.test(svg) && !/<(?:script|foreignObject)\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|\/\/|javascript:)/i.test(svg)) return 'svg'
  throw new Error('not a safe supported image')
}

async function collect(site) {
  const saved = previous.find(item => item.id === site.id)
  if (saved && !process.argv.includes('--refresh')) {
    try {
      const bytes = await fs.readFile(path.join(destination, saved.file))
      if (createHash('sha256').update(bytes).digest('hex') === saved.sha256) {
        results.push(saved)
        return
      }
    }
    catch { /* Missing local assets are fetched again. */ }
  }
  const htmlPath = path.join(scratch, `${site.id}.html`)
  const candidates = []
  try {
    const html = (await download(site.url, htmlPath)).toString()
    for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
      const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(([, key, value]) => [key.toLowerCase(), value]))
      if (!attributes.href || !/(?:^|\s)(?:icon|apple-touch-icon|shortcut)(?:\s|$)/i.test(attributes.rel || '')) continue
      const width = Number((attributes.sizes || '').match(/(\d+)x/)?.[1] || 0)
      candidates.push({ url: new URL(attributes.href.replaceAll('&amp;', '&'), site.url).href, score: /\.svg(?:\?|$)/i.test(attributes.href) ? 500 : width || (attributes.rel.includes('apple') ? 180 : 32) })
    }
  }
  catch { /* An inaccessible landing page may still serve its official favicon. */ }
  candidates.sort((a, b) => b.score - a.score)
  if (officialOverrides[site.id]) candidates.unshift({ url: officialOverrides[site.id], score: 1000 })
  candidates.push({ url: new URL('/favicon.ico', site.url).href, score: 0 })
  for (const candidate of candidates.slice(0, 5)) {
    try {
      const bytes = await download(candidate.url, path.join(scratch, `${site.id}.image`))
      const ext = extension(bytes)
      const file = `${site.id}.${ext}`
      await fs.writeFile(path.join(destination, file), bytes)
      results.push({ id: site.id, file, website: site.url, source: candidate.url, sha256: createHash('sha256').update(bytes).digest('hex'), retrievedAt: new Date().toISOString().slice(0, 10) })
      console.log(`${site.id}: ${file} (${bytes.length} bytes)`)
      return
    }
    catch { /* Try the next icon explicitly linked by the same official site. */ }
  }
  console.log(`${site.id}: MISSING`)
  if (saved) results.push(saved)
}

let cursor = 0
await Promise.all(Array.from({ length: 6 }, async () => { while (cursor < sites.length) await collect(sites[cursor++]) }))
results.sort((a, b) => a.id.localeCompare(b.id))
await fs.writeFile(path.join(destination, 'sources.json'), `${JSON.stringify(results, null, 2)}\n`)
console.log(`Collected ${results.length}/${sites.length} official website icons; temporary downloads: ${scratch}`)
if (results.length !== sites.length) process.exitCode = 1
