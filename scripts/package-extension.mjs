import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

const sourceRoot = path.resolve('dist/extension')
const artifactRoot = path.resolve('artifacts')
const [, version] = fs.readFileSync(path.resolve('service/assets/version'), 'utf8').trim().split('|')
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))
  throw new Error(`Invalid Chrome extension version: ${version}`)

const archiveName = `panel-next-extension-v${version}.zip`
const archivePath = path.join(artifactRoot, archiveName)

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink())
      throw new Error(`Symbolic links are not allowed in the extension package: ${absolute}`)
    return entry.isDirectory() ? collectFiles(absolute) : [absolute]
  })
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit++)
    crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  return crc >>> 0
})

function crc32(buffer) {
  let crc = 0xFFFFFFFF
  for (const byte of buffer)
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function uint16(value) {
  const buffer = Buffer.allocUnsafe(2)
  buffer.writeUInt16LE(value)
  return buffer
}

function uint32(value) {
  const buffer = Buffer.allocUnsafe(4)
  buffer.writeUInt32LE(value)
  return buffer
}

function dosTimestamp(date) {
  const year = Math.max(1980, date.getFullYear())
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { day, time }
}

function buildZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const absolute of files) {
    const name = path.relative(sourceRoot, absolute).split(path.sep).join('/')
    const nameBuffer = Buffer.from(name)
    const data = fs.readFileSync(absolute)
    const checksum = crc32(data)
    const { day, time } = dosTimestamp(fs.statSync(absolute).mtime)
    const localHeader = Buffer.concat([
      uint32(0x04034B50), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
      uint32(checksum), uint32(data.length), uint32(data.length), uint16(nameBuffer.length), uint16(0), nameBuffer,
    ])
    localParts.push(localHeader, data)
    centralParts.push(Buffer.concat([
      uint32(0x02014B50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
      uint32(checksum), uint32(data.length), uint32(data.length), uint16(nameBuffer.length), uint16(0),
      uint16(0), uint16(0), uint16(0), uint32(0), uint32(offset), nameBuffer,
    ]))
    offset += localHeader.length + data.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.concat([
    uint32(0x06054B50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
    uint32(central.length), uint32(offset), uint16(0),
  ])
  return Buffer.concat([...localParts, central, end])
}

if (!fs.existsSync(sourceRoot))
  throw new Error('Extension build is missing; run pnpm build:extension first.')
const files = collectFiles(sourceRoot).sort()
if (files.length > 0xFFFF)
  throw new Error('Extension package contains too many files for ZIP32.')

fs.mkdirSync(artifactRoot, { recursive: true })
const archive = buildZip(files)
fs.writeFileSync(archivePath, archive, { mode: 0o644 })
const digest = crypto.createHash('sha256').update(archive).digest('hex')
fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${archiveName}\n`, { mode: 0o644 })
console.log(`Packaged ${files.length} files at ${archivePath}`)
console.log(`SHA-256 ${digest}`)
