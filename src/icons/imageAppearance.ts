export interface IconImageAppearance {
  transparent: boolean
  darkMonochrome: boolean
}

/** Inspect a small decoded thumbnail, never fetch or modify the original asset. */
export function classifyIconPixels(pixels: ArrayLike<number>): IconImageAppearance {
  let transparent = 0
  let visible = 0
  let darkNeutral = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 240)
      transparent++
    if (pixels[i + 3] < 128)
      continue
    visible++
    const colors = [pixels[i], pixels[i + 1], pixels[i + 2]]
    if (Math.max(...colors) < 100 && Math.max(...colors) - Math.min(...colors) < 30)
      darkNeutral++
  }
  return {
    transparent: transparent > pixels.length / 4 * 0.05,
    darkMonochrome: visible > 0 && darkNeutral / visible > 0.98,
  }
}

export function readIconImageAppearance(image: HTMLImageElement): IconImageAppearance {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context)
      return { transparent: false, darkMonochrome: false }
    context.drawImage(image, 0, 0, 32, 32)
    return classifyIconPixels(context.getImageData(0, 0, 32, 32).data)
  }
  catch {
    // Cross-origin images without CORS stay readable with a gentle overlay.
    return { transparent: false, darkMonochrome: false }
  }
}
