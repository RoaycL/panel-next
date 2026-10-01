import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(process.argv[2] ?? 'dist/extension')
const manifestPath = path.join(root, 'manifest.json')
const newtabPath = path.join(root, 'newtab.html')
const maxJavaScriptChunkBytes = 500_000

function assert(condition, message) {
  if (!condition)
    throw new Error(message)
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath]
  })
}

assert(fs.existsSync(manifestPath), 'extension manifest is missing')
assert(fs.existsSync(newtabPath), 'extension newtab entry is missing')

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const [, applicationVersion] = fs.readFileSync(path.resolve('service/assets/version'), 'utf8').trim().split('|')
const versionPolicy = JSON.parse(fs.readFileSync(path.resolve('version-policy.json'), 'utf8'))
assert(manifest.manifest_version === 3, 'extension must use Manifest V3')
assert(manifest.version === applicationVersion, 'extension version must match service/assets/version')
assert(manifest.version_name === `${applicationVersion} ${versionPolicy.label}`, 'extension version_name must identify the testing stage')
assert(manifest.chrome_url_overrides?.newtab === 'newtab.html', 'newtab override must point to newtab.html')
assert(manifest.permissions?.includes('storage'), 'extension must declare the storage permission')
assert(manifest.permissions?.includes('alarms'), 'extension update polling requires alarms')
assert(manifest.host_permissions?.includes('https://api.github.com/*'), 'update polling requires GitHub API access')
assert(manifest.background?.service_worker === 'service-worker.js' && manifest.background?.type === 'module', 'update checks require a module service worker')
for (const file of ['service-worker.js', 'update-check.mjs'])
  assert(fs.existsSync(path.join(root, file)), `update worker file missing: ${file}`)
assert(manifest.optional_host_permissions?.includes('https://*/*'), 'extension must declare optional HTTPS host access')
assert(manifest.optional_host_permissions?.includes('http://*/*'), 'extension must declare optional HTTP host access')
assert(Number.parseInt(manifest.minimum_chrome_version, 10) >= 96, 'extension requires Chrome 96+ for Promise-based storage and permissions APIs')

for (const iconPath of Object.values(manifest.icons ?? {}))
  assert(fs.existsSync(path.join(root, iconPath)), `extension icon is missing: ${iconPath}`)

const html = fs.readFileSync(newtabPath, 'utf8')
assert(!/<script[^>]+src=["']https?:\/\//i.test(html), 'remote scripts are not allowed in the extension')

for (const file of filesUnder(root)) {
  const relative = path.relative(root, file)
  assert(path.extname(file) !== '.map', `source map must not be packaged: ${relative}`)
  assert(path.basename(file) !== '.env', `environment file must not be packaged: ${relative}`)
  if (path.extname(file) === '.js') {
    const bytes = fs.statSync(file).size
    assert(bytes <= maxJavaScriptChunkBytes, `extension JavaScript chunk exceeds 500 kB: ${relative} (${bytes} bytes)`)
  }
}

console.log(`Validated Manifest V3 package at ${root}`)
