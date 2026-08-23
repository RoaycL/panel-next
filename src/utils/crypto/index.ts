import AES from 'crypto-js/aes'
import Utf8 from 'crypto-js/enc-utf8'

const CryptoSecret = '__CRYPTO_SECRET__'

export function enCrypto(data: any) {
  const str = JSON.stringify(data)
  return AES.encrypt(str, CryptoSecret).toString()
}

export function deCrypto(data: string) {
  const bytes = AES.decrypt(data, CryptoSecret)
  const str = bytes.toString(Utf8)

  if (str)
    return JSON.parse(str)

  return null
}
