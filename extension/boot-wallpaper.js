// Classic script loaded from <head>, before the application module graph, so
// the saved wallpaper is on the first frame. The key and shape are written by
// rememberBootWallpaper in src/runtime/extension.ts.
(() => {
  try {
    const boot = JSON.parse(localStorage.getItem('panelNext.bootWallpaper') || 'null')
    if (!boot || typeof boot.url !== 'string' || !boot.url)
      return
    const mask = typeof boot.mask === 'number' && boot.mask >= 0 && boot.mask <= 1 ? boot.mask : 0
    const root = document.documentElement
    root.style.background = `linear-gradient(rgba(0,0,0,${mask}),rgba(0,0,0,${mask})) center / cover no-repeat fixed, url(${JSON.stringify(boot.url)}) center / cover no-repeat fixed, #101012`
    // The value names the painted URL so the app can drop it once it differs.
    root.setAttribute('data-boot-wallpaper', boot.url)
  }
  catch {
    // A missing mirror only costs the early paint.
  }
})()
