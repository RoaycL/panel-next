import { defineStore } from 'pinia'
import { defaultState, defaultStatePanelConfig, getLocalState, migrateLegacyBranding, removeLocalState, setLocalState } from './helper'
import { router } from '@/router'
import type { PanelStateNetworkModeEnum } from '@/enums'
import { get as getUserConfig } from '@/api/panel/userConfig'
import { preparePanelAppearance } from '@/themes/legacyAdapter'
import type { PanelAppearanceResult } from '@/themes/legacyAdapter'
import type { ThemeMode, ThemeSurface } from '@/themes/types'
import { getRuntime } from '@/runtime'
import { saveExtensionAppearance } from '@/runtime/extensionAppearance'
export const usePanelState = defineStore('panel', {
  state: (): Panel.State => getLocalState() || defaultState(),

  getters: {

  },

  actions: {
    setLeftSiderCollapsed(Collapsed: boolean) {
      this.leftSiderCollapsed = Collapsed
      // this.recordState()
    },

    setRightSiderCollapsed(Collapsed: boolean) {
      this.rightSiderCollapsed = Collapsed
      // this.recordState()
    },

    setNetworkMode(mode: PanelStateNetworkModeEnum) {
      this.networkMode = mode
      this.recordState()
    },

    // 获取云端（搭建的服务器）的面板配置
    async updatePanelConfigByCloud() {
      const res = await getUserConfig<Panel.userConfig>()
      if (res.code === 0)
        this.applyPanelConfig(res.data.panel)
      else
        this.resetPanelConfig() // 重置恢复默认
      if (res.code !== 0)
        this.recordState()
      return res.code === 0
    },

    resetPanelConfig() {
      this.panelConfig = defaultStatePanelConfig()
    },

    applyPanelConfig(config: Panel.panelConfig, options: {
      surface?: ThemeSurface
      mode?: ThemeMode
      /** Extension-only: 把清理/迁移后的配置写回 EXTENSION_APPEARANCE_KEY。Web 端禁止传 true。 */
      writeBack?: boolean
    } = {}): PanelAppearanceResult {
      // 统一外观入口：每个入口只在这里跑一次 preparePanelAppearance，
      // 返回 { config, changed, issues }，并只在 Extension 端回写清理后的配置。
      const surface = options.surface ?? (getRuntime().kind === 'extension' ? 'extension' : 'web')
      const mode = options.mode ?? 'auto'
      const appearance = preparePanelAppearance(config, surface, mode, migrateLegacyBranding)
      this.panelConfig = { ...defaultStatePanelConfig(), ...appearance.config }
      // 只在 Extension 端回写；saveExtensionAppearance 自带字节去重，
      // 未发生变化时不会实际写存储（回显抑制），也不会触发 storage.onChanged 回声。
      if (options.writeBack && surface === 'extension') {
        // 把写回 Promise 挂到返回值上：调用方（bootstrap / storage.onChanged / 同步）
        // 可 await 确认持久化完成并感知失败，而不是 fire-and-forget 后仅 console.error。
        appearance.writeBack = saveExtensionAppearance(this.panelConfig).then(
          result => result !== false,
          (error) => {
            console.error('Failed to persist cleaned extension appearance.', error)
            return false
          },
        )
      }
      this.recordState()
      return appearance
    },

    // async refreshSpaceNoteList(spaceId: string) {
    //   await getListBySpaceNoteId<Common.ListResponse<SNote.InfoTree[]>>(spaceId).then((res) => {
    //     this.notesList = res.data.list
    //   })
    // },

    async reloadRoute(id?: number) {
      // this.recordState()
      await router.push({ name: 'AppletDialog', params: { aiAppletId: id } })
    },

    recordState() {
      setLocalState(this.$state)
    },

    removeState() {
      removeLocalState()
    },
  },
})
