import path from 'node:path'
import fs from 'node:fs'
import process from 'node:process'
import type { PluginOption } from 'vite'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { createSvgIconsPlugin } from 'vite-plugin-svg-icons'

function extensionManifestPlugin(): PluginOption {
  return {
    name: 'panel-next-extension-manifest',
    apply: 'build',
    generateBundle() {
      const [, version] = fs.readFileSync(path.resolve(process.cwd(), 'service/assets/version'), 'utf8').trim().split('|')
      const manifest = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'extension/manifest.json'), 'utf8'))
      manifest.version = version
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
  }
}

function setupPlugins(env: ImportMetaEnv, extension: boolean): PluginOption[] {
  return [
    vue(),
    !extension && env.VITE_GLOB_APP_PWA === 'true' && VitePWA({
      injectRegister: 'auto',
      manifest: {
        name: 'Panel Next',
        short_name: 'Panel Next',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
    createSvgIconsPlugin({
      iconDirs: [path.resolve(process.cwd(), 'src/assets/svg-icons')],
      symbolId: '[name]',
    }),
    extension && extensionManifestPlugin(),
  ]
}

export default defineConfig((env) => {
  const viteEnv = loadEnv(env.mode, process.cwd()) as unknown as ImportMetaEnv
  const extension = env.mode === 'extension'

  return {
    root: extension ? path.resolve(process.cwd(), 'extension') : process.cwd(),
    base: extension ? './' : '/',
    publicDir: path.resolve(process.cwd(), 'public'),
    define: {
      __PANEL_RUNTIME__: JSON.stringify(extension ? 'extension' : 'web'),
    },
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), 'src'),
      },
    },
    plugins: setupPlugins(viteEnv, extension),
    server: {
      host: '0.0.0.0',
      port: 1002,
      open: false,
      proxy: {
        '/api': {
          target: viteEnv.VITE_APP_API_BASE_URL,
          changeOrigin: true, // 允许跨域
          rewrite: path => path.replace('/api/', '/api/'),
        },
        '/uploads': {
          target: viteEnv.VITE_APP_API_BASE_URL,
          changeOrigin: true, // 允许跨域
          rewrite: path => path.replace('/uploads/', '/uploads/'),
        },
      },
    },
    build: {
      outDir: extension ? path.resolve(process.cwd(), 'dist/extension') : path.resolve(process.cwd(), 'dist'),
      emptyOutDir: true,
      rollupOptions: extension
        ? { input: path.resolve(process.cwd(), 'extension/newtab.html') }
        : undefined,
      reportCompressedSize: false,
      sourcemap: false,
      commonjsOptions: {
        ignoreTryCatch: false,
      },
      terserOptions: {
        compress: {
          drop_console: true,
        },
      },
    },
  }
})
