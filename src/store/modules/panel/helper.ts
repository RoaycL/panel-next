import { persistentStorage } from '@/utils/storage'
import { defaultFooterHtml } from '@/utils/defaultFooter'
import { migrateLegacyFooterHtml } from '@/utils/branding'
import { PanelPanelConfigStyleEnum, PanelStateNetworkModeEnum } from '@/enums'
import defaultBackground from '@/assets/defaultBackground.webp'
import { getRuntime } from '@/runtime'
const LOCAL_NAME = 'panelStorage'

export function defaultStatePanelConfig(): Panel.panelConfig {
  return {
    backgroundImageSrc: getRuntime().kind === 'extension' ? '' : defaultBackground,
    backgroundBlur: 0,
    backgroundMaskNumber: 0,
    iconStyle: PanelPanelConfigStyleEnum.icon,
    iconTextColor: '#ffffff',
    iconTextInfoHideDescription: false,
    iconTextIconHideTitle: false,
    logoText: 'Panel Next',
    logoImageSrc: '',
    logoShow: true,
    clockShowSecond: false,
    clockColor: '',
    clockShow: true,
    searchBoxShow: false,
    searchBoxSearchIcon: false,
    marginBottom: 10,
    marginTop: 10,
    maxWidth: 1200,
    maxWidthUnit: 'px',
    marginX: 5,
    footerHtml: defaultFooterHtml,
    systemMonitorShow: false,
    systemMonitorShowTitle: true,
    systemMonitorPublicVisitModeShow: false,
    netModeChangeButtonShow: true,

  }
}

/** 品牌迁移：命中历史 Sun-Panel 品牌特征的页脚替换为 Panel Next 默认值。 */
export function migrateLegacyBranding(config: Panel.panelConfig): Panel.panelConfig {
  return migrateLegacyFooterHtml(config)
}

export function defaultState(): Panel.State {
  return {
    rightSiderCollapsed: false,
    leftSiderCollapsed: false,
    networkMode: PanelStateNetworkModeEnum.auto,
    panelConfig: { ...defaultStatePanelConfig() },
  }
}

export function getLocalState(): Panel.State {
  const localState = persistentStorage.get<Partial<Panel.State>>(LOCAL_NAME)
  const merged = { ...defaultState(), ...localState }
  merged.panelConfig = migrateLegacyBranding({ ...defaultStatePanelConfig(), ...merged.panelConfig })
  return merged
}

export function setLocalState(state: Panel.State) {
  persistentStorage.set(LOCAL_NAME, state)
}

export function removeLocalState() {
  persistentStorage.remove(LOCAL_NAME)
}
