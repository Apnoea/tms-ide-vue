// Выбор файла на чтение. File System Access API — ПРОГРЕССИВНОЕ УЛУЧШЕНИЕ, а не
// требование: сам файл прекрасно отдаёт `<input type="file">`, который есть везде.
// FSA нужен ровно за одним — за `handle`, который переживает reload (по нему tag-list
// освежается на старте). Требовать его целиком нельзя: Brave отключает FSA по
// умолчанию (fingerprinting), в Firefox и Safari пользовательских пикеров нет вовсе —
// а без фолбэка там не открыть ни проект, ни tag-list.

function hasFsaPicker() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
}

/**
 * Диалог выбора одного файла. Зовётся ИЗ user-gesture (оба пути этого требуют).
 *
 * @param {object} [opts]
 * @param {string[]} [opts.extensions] — расширения (`['.csv']`) для фильтра пикера
 * @param {string} [opts.mime] — MIME для FSA-фильтра (`accept` требует пару)
 * @param {string} [opts.description] — подпись фильтра в диалоге FSA
 * @param {FileSystemHandle} [opts.startInHandle] — открыть диалог там же (только FSA)
 * @returns {Promise<{ file: File, handle: FileSystemFileHandle|null }|null>} `null` —
 *   пользователь отменил выбор. `handle: null` — браузер без FSA: файл прочитан, но
 *   вернуться к нему потом (тихое обновление) не получится.
 */
export async function pickFile({ extensions, mime, description, startInHandle } = {}) {
  if (hasFsaPicker()) {
    const options = { multiple: false }
    if (extensions?.length) {
      options.types = [{ description, accept: { [mime || '*/*']: extensions } }]
    }
    // showOpenFilePicker сам открывает диалог в родительской папке файла, когда
    // startIn — file handle (или в самой папке если directory handle).
    if (startInHandle) options.startIn = startInHandle
    try {
      const [handle] = await window.showOpenFilePicker(options)
      return { file: await handle.getFile(), handle }
    } catch (e) {
      if (e?.name === 'AbortError') return null
      // Функция есть, но вызвать её не дали (политика приватности, отсутствие
      // user-activation, iframe без permission). Это НЕ повод отказать в открытии
      // файла: браузеры блокируют FSA по-разному — где-то API удалено, где-то
      // бросает, — и единственные входы данных (проект, tag-list) обязаны работать
      // в обоих случаях.
      console.warn('[fileSystem] FSA-пикер недоступен, открываем через input:', e)
    }
  }
  const file = await pickViaInput(extensions)
  return file ? { file, handle: null } : null
}

/** Сколько ждать `change` после возврата фокуса, прежде чем счесть выбор отменённым. */
const INPUT_CANCEL_GRACE_MS = 1000

/**
 * Фолбэк без FSA. Промис ОБЯЗАН разрешиться в любом случае: пикер зовут из-под
 * `projectBusy`, и «висячий» промис оставил бы всю область редактирования `inert`
 * до перезагрузки. Поэтому исходов три, а не один:
 *   • `change` — файл выбран;
 *   • `cancel` — отмена (событие есть не во всех браузерах);
 *   • возврат фокуса в окно — страховка на остальные: ждём `change` ещё
 *     `INPUT_CANCEL_GRACE_MS`, потом решаем по `files`. Проверять поддержку `cancel`
 *     фичей нельзя (`'oncancel' in input` истинно и там, где событие для файлового
 *     инпута не эмитится), поэтому страховка безусловная: диалог почти везде модален
 *     к окну, так что фокус возвращается уже после выбора или отмены. Цена ошибки
 *     несимметрична — лишняя «отмена» стоит повторного клика, а не разрешённый промис
 *     оставил бы `projectBusy` поднятым до перезагрузки.
 */
function pickViaInput(extensions) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = false
    if (extensions?.length) input.accept = extensions.join(',')
    // Вне вьюпорта, а не display:none — скрытый инпут в части браузеров не кликается.
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'

    let done = false
    const finish = (file) => {
      if (done) return
      done = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(file || null)
    }
    const onFocus = () => setTimeout(() => finish(input.files?.[0]), INPUT_CANCEL_GRACE_MS)

    input.addEventListener('change', () => finish(input.files?.[0]), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    window.addEventListener('focus', onFocus)

    document.body.appendChild(input)
    try {
      input.click()
    } catch (e) {
      // Клик не дали (нет user-activation) — отдаём отмену, иначе вызывающий ждал бы
      // вечно, а вместе с ним висел бы projectBusy.
      console.warn('[fileSystem] Не удалось открыть диалог выбора файла:', e)
      finish(null)
    }
  })
}

export async function getFileContentFromHandle(fileHandle) {
  try {
    const file = await fileHandle.getFile()
    return await file.text()
  } catch (e) {
    console.error('Ошибка чтения файла:', e)
    return null
  }
}
