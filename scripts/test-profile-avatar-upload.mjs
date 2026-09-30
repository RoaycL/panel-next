import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync(new URL('../src/utils/profileAvatarUpload.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const { validateAvatarUpload, readUploadedAvatar, MAX_AVATAR_UPLOAD_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
assert.equal(validateAvatarUpload({ name: 'photo.JPG', type: 'image/jpeg', size: 100 }), null)
assert.equal(validateAvatarUpload({ name: 'photo.webp', type: 'image/webp', size: MAX_AVATAR_UPLOAD_BYTES }), null)
for (const file of [
  { name: 'photo.svg', type: 'image/svg+xml', size: 100 },
  { name: 'photo.heic', type: 'image/heic', size: 100 },
  { name: 'photo.png', type: 'text/html', size: 100 },
  { name: 'photo.png', type: 'image/png', size: 0 },
  { name: 'photo.png', type: 'image/png', size: MAX_AVATAR_UPLOAD_BYTES + 1 },
]) assert.ok(validateAvatarUpload(file))
for (const imageUrl of ['/uploads/avatar.png', 'uploads/avatar.webp', 'https://example.com/avatar.jpg'])
  assert.equal(readUploadedAvatar(JSON.stringify({ code: 0, data: { imageUrl } })), imageUrl)
for (const response of ['not JSON', 'null', '{}', JSON.stringify({ code: 1000, msg: '请登录' })])
  assert.throws(() => readUploadedAvatar(response))
for (const imageUrl of ['', 123, 'javascript:alert(1)', 'data:image/png;base64,abc', '//example.com/avatar.png', 'https://', 'https://name:password@example.com/avatar.png', 'a\\b.png', 'a'.repeat(201)])
  assert.throws(() => readUploadedAvatar(JSON.stringify({ code: 0, data: { imageUrl } })))
const profile = fs.readFileSync(new URL('../src/components/apps/UserInfo/index.vue', import.meta.url), 'utf8')
assert.match(profile, /@before-upload="beforeAvatarUpload"/)
assert.match(profile, /@error="failAvatarUpload"/)
assert.match(profile, /:disabled="!isProfileDirty \|\| isUploadingAvatar"/)
assert.match(profile, /profileHeadImage\.value = readUploadedAvatar/)
console.log('Avatar upload validation, response safety and draft-only editing passed.')
