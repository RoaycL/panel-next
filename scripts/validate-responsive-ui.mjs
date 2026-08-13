import assert from 'node:assert/strict'
import fs from 'node:fs'

const home = fs.readFileSync(new URL('../src/views/home/index.vue', import.meta.url), 'utf8')
const starter = fs.readFileSync(new URL('../src/views/home/components/AppStarter/index.vue', import.meta.url), 'utf8')
const theme = fs.readFileSync(new URL('../src/hooks/useTheme.ts', import.meta.url), 'utf8')

for (const rule of [
  /\.sun-main\s*\{[^}]*overflow:\s*hidden/,
  /\.runtime-status-bar\s*\{[^}]*flex-wrap:\s*wrap/,
  /@media \(max-width: 640px\)/,
  /font-size:\s*clamp\(/,
  /max-width:\s*calc\(100% - 20px\)/,
]) {
  assert.match(home, rule)
}
assert.match(starter, /isSmallScreen/)
assert.match(starter, /screenWidth\.value < 640/)
assert.match(starter, /dark:/)
assert.match(theme, /document\.documentElement\.classList\.(?:add|remove)\('dark'\)/)
assert.match(theme, /useOsTheme/)
assert.match(home, /<SvgIcon/g)

console.log('Validated narrow-screen clipping, responsive controls, SVG icons, and light/dark theme hooks')
