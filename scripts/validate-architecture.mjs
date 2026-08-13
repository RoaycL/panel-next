import fs from 'node:fs'
import path from 'node:path'
import fg from 'fast-glob'

const allowedPlatformFiles = new Set([
  'src/runtime/extension.ts',
  'src/runtime/web.ts',
])
const forbidden = [
  { name: 'Chrome API', pattern: /\bchrome\s*\./g },
  { name: 'localStorage', pattern: /\b(?:window\s*\.\s*)?localStorage\b/g },
  { name: 'sessionStorage', pattern: /\b(?:window\s*\.\s*)?sessionStorage\b/g },
  { name: 'legacy ss/ls storage alias', pattern: /\b(?:ss|ls)\s*\./g },
  { name: 'window.open', pattern: /\bwindow\s*\.\s*open\s*\(/g },
  { name: 'literal API upload action', pattern: /\baction\s*=\s*["']\/api\//g },
]

const violations = []
for (const file of await fg('src/**/*.{ts,tsx,vue}', { onlyFiles: true })) {
  const normalized = file.split(path.sep).join('/')
  if (allowedPlatformFiles.has(normalized))
    continue
  const source = fs.readFileSync(file, 'utf8')
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0
    for (const match of source.matchAll(rule.pattern)) {
      const line = source.slice(0, match.index).split('\n').length
      violations.push(`${normalized}:${line}: direct ${rule.name} access must use a runtime adapter`)
    }
  }
}

if (violations.length)
  throw new Error(`Architecture boundary violations:\n${violations.join('\n')}`)
console.log('Validated runtime and storage architecture boundaries')
