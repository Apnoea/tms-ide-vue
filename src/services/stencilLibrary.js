/**
 * Персист стенсилов на диск через dev-эндпоинт (см. stencilWritePlugin в
 * vite.config.js): браузер писать в src/stencils/definitions/ не может, поэтому
 * dev-сервер делает это за него, а Vite-вотчер триггерит reload → glob реестра
 * подхватывает файлы навсегда.
 *
 * Контракт: POST /__stencils/import, тело [{ id, stencilJson, shapeSvg }].
 * В проде плагина нет (apply: 'serve') → fetch падает/404 → возвращаем false;
 * caller решает (стенсил всё равно в рантайм-реестре и уедет в library/ проекта).
 *
 * @param {Array<{id:string, stencilJson:object, shapeSvg:string}>} items
 * @returns {Promise<boolean>} успех записи на диск
 */
export async function persistStencilsToDisk(items) {
  if (!items?.length) return false
  try {
    const res = await fetch('/__stencils/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(items),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Удаление стенсила с диска (definitions/<id>/) через тот же dev-эндпоинт.
 * В проде плагина нет → false; caller уже снял стенсил из рантайм-реестра.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteStencilFromDisk(id) {
  if (!id) return false
  try {
    const res = await fetch('/__stencils/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    return res.ok
  } catch {
    return false
  }
}
