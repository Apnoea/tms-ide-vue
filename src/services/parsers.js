/**
 * Парсит tag-list. Формат каждой строки: "TAG.NAME=Type;...".
 * Пропускает пустые строки и комментарии (начинаются с #) — в заголовке файла
 * обычно идёт пояснение формата + разделители из решёток, они нам не теги.
 * Возвращает массив { name, type }.
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
