const fs = require('fs')

// 从唯一发布版本源读取版本号（DUAL-02：service/assets/version 为唯一版本源）
// 文件格式："<version_code>|<semantic_version>"，如 "10|1.3.0"
let appVersion = ''
try {
  const versionSource = fs.readFileSync('service/assets/version', 'utf-8').trim()
  const parts = versionSource.split('|')
  if (parts.length >= 2)
    appVersion = parts[1].trim()
}
catch {
  // 读取失败时回退到日期标记
  const moment = require('moment')
  appVersion = moment().utc().format('YYYYMMDD')
}

const contentToAppend = `\nVITE_APP_VERSION=${appVersion}`
const envFilePath = '.env'
let envContent = fs.readFileSync(envFilePath, 'utf-8')

const versionRegex = /^VITE_APP_VERSION=.*$/m
if (versionRegex.test(envContent)) {
  envContent = envContent.replace(versionRegex, contentToAppend)
}
else {
  envContent = envContent + contentToAppend
}

fs.writeFileSync(envFilePath, envContent)

console.log('update to .env file.', contentToAppend)
