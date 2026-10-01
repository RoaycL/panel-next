import type { App } from 'vue'

/** Release focus before a modal transition hides an ancestor from assistive tech.
 * Naive UI's focus trap still owns focus inside the dialog and its restoration.
 */
export function installModalFocusGuard(app: App) {
  app.mixin({
    created() {
      if (this.$options.name !== 'Modal') return
      this.$watch(() => (this.$props as { show?: boolean }).show, (show: boolean) => {
        if (show) return // Let the focus trap remember the opening control.
        const active = document.activeElement
        if (active instanceof HTMLElement && active !== document.body)
          active.blur()
      }, { flush: 'sync' })
    },
  })
}
