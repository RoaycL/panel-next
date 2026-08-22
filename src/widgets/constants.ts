/** 组件实例 ID 规则：字母数字开头，允许 . _ -，长度 1~64。 */
export const WIDGET_ID_PATTERN = /^[a-z\d][\w.-]{0,63}$/i

/**
 * 组件类型标识规则：小写字母开头，仅小写字母/数字/点/连字符。
 * 推荐使用 `<vendor>.<name>` 命名空间（如 core.clock、acme.stock），
 * 内置组件保留 `core.` 前缀，第三方请使用自己的前缀避免冲突。
 */
export const WIDGET_TYPE_PATTERN = /^[a-z][a-z\d.-]{0,63}$/
