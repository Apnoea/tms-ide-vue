// Минимальная key-value обёртка над IndexedDB. Хранит то, что localStorage не
// тянет: FileSystemFileHandle tag-list'а (не сериализуется в JSON — браузер
// держит как ссылку, см. TagListControl) и проект (формы/мета — крупнее квоты
// localStorage, см. useAutosave).
//
// Пара ~20 строк против полноценного idb-keyval-пакета: для нескольких ключей
// своего достаточно, бандл не раздуваем.

const DB_NAME = 'tms-ide'
const STORE = 'kv'
const DB_VERSION = 1

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      // Сбрасываем кэш, иначе следующий вызов вернёт ту же реджектнутую
      // promise и IndexedDB никогда не переоткроется (приватный режим / гонка).
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

/**
 * Читает значение. `{ ok, value }`: `ok: false` — чтение НЕ УДАЛОСЬ (хранилище
 * недоступно / транзакция упала), это НЕ то же самое, что «записи нет»
 * (`ok: true, value: undefined`). Разница критична для восстановления проекта:
 * приняв сбой чтения за пустой старт, код перезаписал бы данные бутстрапом.
 */
export async function idbTryGet(key) {
  try {
    const db = await openDB()
    const value = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    return { ok: true, value }
  } catch (e) {
    console.error('[idb] чтение не удалось:', key, e)
    return { ok: false, value: undefined }
  }
}

/**
 * Читает значение, не различая «нет записи» и «ошибка чтения» — обе дают
 * `undefined`. Годится там, где отсутствие данных безобидно (file-handle
 * tag-list'а, сырой текст тегов). Для проекта — `idbTryGet`.
 */
export async function idbGet(key) {
  const { value } = await idbTryGet(key)
  return value
}

/**
 * Пишет значение. Возвращает true при успехе, false при ошибке (квота /
 * приватный режим). НЕ бросает — fire-and-forget вызовы не ломаются, а кому
 * важен результат (autosave-индикатор), проверяет флаг и не врёт «сохранено».
 */
export async function idbSet(key, value) {
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      // QuotaExceeded и пр. могут поднять onabort без onerror — без этого
      // обработчика промис висит вечно.
      tx.onabort = () => reject(tx.error)
    })
    return true
  } catch (e) {
    // Реальная причина (QuotaExceededError / DataCloneError / приватный режим) —
    // в консоль: наружу отдаём только false, но без лога диагностировать нечем.
    console.error('[idb] запись не удалась:', key, e)
    return false
  }
}

/** Все ключи хранилища. Для GC осиротевших project:form:* записей. [] при ошибке. */
export async function idbKeys() {
  try {
    const db = await openDB()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  } catch {
    return []
  }
}

export async function idbDel(key) {
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch {
    /* ignore */
  }
}
