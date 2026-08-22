import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import process from 'node:process'

const maxTrackedFileBytes = 10 * 1024 * 1024
const generatedPathPatterns = [
  /^artifacts\//,
  /^dist\//,
  /^release\//,
  /^service\/panel-next(?:\.exe)?$/,
]
const retiredPaths = new Set([
  'sun-panel.code-workspace',
])

const gitFiles = spawnSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
if (gitFiles.status !== 0)
  throw gitFiles.error || new Error(gitFiles.stderr || 'Unable to list tracked files.')

const trackedFiles = gitFiles.stdout
  .split('\0')
  .filter(Boolean)

const problems = []
for (const file of trackedFiles) {
  // A cleanup can be validated before it is committed; deleted index entries
  // are no longer part of the projected repository contents.
  if (!existsSync(file))
    continue
  if (generatedPathPatterns.some(pattern => pattern.test(file)))
    problems.push(`${file}: generated build output must not be tracked`)
  if (retiredPaths.has(file))
    problems.push(`${file}: retired fork-era path must not be restored`)

  const size = statSync(file).size
  if (size > maxTrackedFileBytes)
    problems.push(`${file}: tracked file is ${(size / 1024 / 1024).toFixed(1)} MiB (limit: 10 MiB)`)
}

if (problems.length > 0) {
  console.error('Repository hygiene validation failed:')
  for (const problem of problems)
    console.error(`- ${problem}`)
  process.exit(1)
}

console.log(`Repository hygiene validation passed (${trackedFiles.length} tracked files checked).`)
