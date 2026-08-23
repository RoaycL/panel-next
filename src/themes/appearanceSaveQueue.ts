/**
 * 统一外观保存队列。
 *
 * 背景：Web 端 userConfig/set 保存的是「整份 panelConfig」，Extension 端的外观写入
 * 也覆盖整个外观载荷。若同一账号的多个整份配置写入（主题、壁纸、布局、widget 等）并发
 * 交错，服务端/本地存储的最后写入者会覆盖彼此。
 *
 * 本模块提供一个进程内串行队列：任务按提交顺序先后执行，前一个任务 settle 后才启动
 * 下一个，保证任意时刻只有一个整份外观写入在进行。队列不吞掉任何任务的异常；单个任务
 * 失败不会阻塞后续任务（失败本身由调用方返回给 UI）。
 *
 * 主题、Widget 布局、Style、壁纸、上传文件设壁纸与离线 panel.set 重放均接入本队列。
 * 跨标签页仍由 navigator.locks（离线重放）和服务端 expectedRevision 负责仲裁。
 */
type AppearanceSaveTask<T> = () => Promise<T>

let tail: Promise<unknown> = Promise.resolve()

export function enqueueAppearanceSave<T>(task: AppearanceSaveTask<T>): Promise<T> {
  const run = tail.then(task, task)
  // 无论本次任务成功或失败，都让链继续向前（next 任务只在本次 settle 后启动）。
  tail = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}
