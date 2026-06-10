// File System Access API helpers.
// Сейчас используется только для tag-list-пикера в ProjectActions.

function isFileSystemAccessSupported() {
  return typeof window !== 'undefined' && window.showDirectoryPicker && window.showOpenFilePicker
}

export async function selectFile(startInHandle = null, accept = null) {
  if (!isFileSystemAccessSupported()) {
    throw new Error('Браузер не поддерживает File System Access API')
  }

  const options = { multiple: false }
  if (accept) {
    // accept: [{ description, accept: { mime: [extensions] } }]
    options.types = accept
  }
  // showOpenFilePicker сам открывает диалог в родительской папке файла, когда
  // startIn — file handle (или в самой папке если directory handle).
  if (startInHandle) options.startIn = startInHandle

  try {
    const [fileHandle] = await window.showOpenFilePicker(options)
    return fileHandle
  } catch (e) {
    if (e.name === 'AbortError') {
      return null
    }
    throw e
  }
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
