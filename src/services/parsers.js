/** Тип тега из tag-list булев (Boolean/Bool/…). */
export const isBooleanType = (type) => /^bool/i.test(type || '')

/**
 * Парсит tag-list: строки вида "TAG.NAME=Type;...". Пустые строки и комментарии (#)
 * пропускаются — в заголовке файла обычно пояснение формата. → [{ name, type }].
 */
export function parseTagList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const [left, right] = line.split('=')
      const [type] = right.split(';')
      return { name: left.trim(), type: type.trim() }
    })
}
