import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/runtime/url.ts', import.meta.url), 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'url.ts',
  reportDiagnostics: true,
})
if (transpiled.diagnostics?.length)
  throw new Error('Unable to transpile runtime URL policy')
const encoded = Buffer.from(transpiled.outputText).toString('base64')
const { resolveHttpUrl } = await import(`data:text/javascript;base64,${encoded}`)

assert.equal(resolveHttpUrl('/apps', 'https://panel.example.com/home'), 'https://panel.example.com/apps')
assert.equal(resolveHttpUrl('http://server.lan', 'https://panel.example.com'), 'http://server.lan/')
for (const unsafe of ['javascript:alert(1)', 'data:text/html,unsafe', 'file:///etc/passwd', 'mailto:user@example.com'])
  assert.throws(() => resolveHttpUrl(unsafe, 'https://panel.example.com'), /HTTP and HTTPS/)

const appSource = fs.readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
assert.match(appSource, /<div class="h-full" @click\.capture="handleRuntimeLink" @auxclick\.capture="handleRuntimeLink">/)

console.log('Validated centralized HTTP(S) navigation and rendered-link interception')
