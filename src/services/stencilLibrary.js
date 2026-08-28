/**
 * Персист символов на диск через dev-эндпоинт (stencilWritePlugin в vite.config.js):
 * браузер в src/stencils/definitions/ писать не может, это делает dev-сервер, а
 * Vite-вотчер триггерит reload, и glob реестра подхватывает файлы.
 *
 * Контракт: POST /__stencils/import, тело [{ id, stencilJson, shapeSvg }]. В проде
 * плагина нет (apply: 'serve') → false; символ остаётся в рантайм-реестре и уедет в
 * library/ проекта.
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
 * Удаление символа с диска (definitions/<id>/) через тот же dev-эндпоинт.
 * В проде плагина нет → false; caller уже снял символ из рантайм-реестра.
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
