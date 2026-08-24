import { onUnmounted, ref } from 'vue'
import type { WidgetInstance, WidgetSize } from './types'
import { canResizeWidgetAxis, resizeInstanceToWithinBounds } from './registry'

export type WidgetResizeDirection = 'columns' | 'rows' | 'both'

interface GridResizeOptions {
  onStart?: (instance: WidgetInstance) => void
  onPreview?: (instance: WidgetInstance) => void
  onCommit: (instance: WidgetInstance, previous: WidgetSize) => void | Promise<void>
  onCancel?: (instance: WidgetInstance) => void
  onFinish?: (instance: WidgetInstance, changed: boolean, cancelled: boolean) => void
}

interface ResizeSession {
  instance: WidgetInstance
  direction: WidgetResizeDirection
  initial: WidgetSize
  startX: number
  startY: number
  columnStep: number
  rowStep: number
  pointerId: number
  handle: HTMLElement
  changed: boolean
}

function numericCssValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/**
 * 把边框指针位移转换成 Widget 网格尺寸。移动期间只更新内存预览，
 * pointerup 后提交一次；Escape / pointercancel 恢复开始前尺寸。
 */
export function useWidgetGridResize(options: GridResizeOptions) {
  const activeWidgetId = ref<string | null>(null)
  let session: ResizeSession | null = null

  function cleanupListeners() {
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerCancel)
    window.removeEventListener('keydown', handleKeyDown)
    document.documentElement.classList.remove('is-widget-resizing')
  }

  function finish(cancelled: boolean) {
    const current = session
    if (!current)
      return
    cleanupListeners()
    session = null
    activeWidgetId.value = null
    try {
      if (current.handle.hasPointerCapture(current.pointerId))
        current.handle.releasePointerCapture(current.pointerId)
    }
    catch {
      // Pointer capture may already be released by the browser.
    }
    try {
      if (cancelled) {
        current.instance.size = { ...current.initial }
        options.onCancel?.(current.instance)
      }
      else if (current.changed) {
        void options.onCommit(current.instance, current.initial)
      }
    }
    finally {
      options.onFinish?.(current.instance, current.changed, cancelled)
    }
  }

  function handlePointerMove(event: PointerEvent) {
    const current = session
    if (!current || event.pointerId !== current.pointerId)
      return
    event.preventDefault()
    const columnDelta = Math.round((event.clientX - current.startX) / current.columnStep)
    const rowDelta = Math.round((event.clientY - current.startY) / current.rowStep)
    const requested: WidgetSize = {
      columns: current.initial.columns,
      rows: current.initial.rows,
    }
    if ((current.direction === 'columns' || current.direction === 'both') && canResizeWidgetAxis(current.instance.type, 'columns'))
      requested.columns += columnDelta
    if ((current.direction === 'rows' || current.direction === 'both') && canResizeWidgetAxis(current.instance.type, 'rows'))
      requested.rows += rowDelta
    if (resizeInstanceToWithinBounds(current.instance, requested)) {
      current.changed = current.instance.size.columns !== current.initial.columns || current.instance.size.rows !== current.initial.rows
      options.onPreview?.(current.instance)
    }
  }

  function handlePointerUp(event: PointerEvent) {
    if (session && event.pointerId === session.pointerId)
      finish(false)
  }

  function handlePointerCancel(event: PointerEvent) {
    if (session && event.pointerId === session.pointerId)
      finish(true)
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      finish(true)
    }
  }

  function startWidgetResize(
    event: PointerEvent,
    instance: WidgetInstance,
    direction: WidgetResizeDirection,
    grid: HTMLElement | null,
  ) {
    if (!grid || session || (event.pointerType === 'mouse' && event.button !== 0))
      return
    const allowsColumns = direction !== 'rows' && canResizeWidgetAxis(instance.type, 'columns')
    const allowsRows = direction !== 'columns' && canResizeWidgetAxis(instance.type, 'rows')
    if (!allowsColumns && !allowsRows)
      return

    const style = getComputedStyle(grid)
    const columnCount = style.gridTemplateColumns.split(' ').filter(Boolean).length
    // 单列响应式布局中横向尺寸没有视觉反馈，只保留纵向缩放。
    const effectiveDirection = columnCount <= 1
      ? (allowsRows ? 'rows' : null)
      : direction
    if (!effectiveDirection)
      return
    const columnGap = numericCssValue(style.columnGap, 14)
    const rowGap = numericCssValue(style.rowGap, columnGap)
    const rowHeight = numericCssValue(style.getPropertyValue('--widget-grid-row-height'), 96)
    const columnWidth = columnCount > 0
      ? Math.max(1, (grid.clientWidth - columnGap * (columnCount - 1)) / columnCount)
      : grid.clientWidth
    const handle = event.currentTarget
    if (!(handle instanceof HTMLElement))
      return

    event.preventDefault()
    event.stopPropagation()
    handle.setPointerCapture(event.pointerId)
    session = {
      instance,
      direction: effectiveDirection,
      initial: { ...instance.size },
      startX: event.clientX,
      startY: event.clientY,
      columnStep: columnWidth + columnGap,
      rowStep: rowHeight + rowGap,
      pointerId: event.pointerId,
      handle,
      changed: false,
    }
    activeWidgetId.value = instance.id
    options.onStart?.(instance)
    document.documentElement.classList.add('is-widget-resizing')
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('keydown', handleKeyDown)
  }

  onUnmounted(() => finish(true))

  return {
    activeWidgetId,
    startWidgetResize,
    cancelWidgetResize: () => finish(true),
  }
}
