// Минимальная key-value обёртка над IndexedDB. Хранит то, что localStorage не тянет:
// FileSystemFileHandle tag-list'а (в JSON не сериализуется) и проект (формы/мета —
// крупнее квоты localStorage).

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
      // Сброс кэша: иначе следующий вызов получит ту же реджектнутую promise и база
      // не переоткроется.
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

/**
 * Читает значение. `{ ok, value }`: `ok: false` — чтение НЕ УДАЛОСЬ (хранилище
 * недоступно / транзакция упала), что не равно «записи нет» (`ok: true, value:
 * undefined`). Восстановление проекта обязано различать: сбой чтения, принятый за
 * пустой старт, приводит к перезаписи данных бутстрапом.
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
 * Читает значение, не различая «нет записи» и «ошибка чтения» — обе дают `undefined`.
 * Для данных проекта — `idbTryGet`.
 */
export async function idbGet(key) {
  const { value } = await idbTryGet(key)
  return value
}

/**
 * Пишет значение: true — успех, false — ошибка (квота / приватный режим). НЕ бросает,
 * поэтому вызывающий обязан проверять результат, если показывает статус «сохранено».
 */
export async function idbSet(key, value) {
  try {
    const db = await openDB()
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      // Квота и подобное поднимают onabort без onerror — без обработчика промис
      // висел бы вечно.
      tx.onabort = () => reject(tx.error)
    })
    return true
  } catch (e) {
    // Наружу уходит только false — причину пишем в консоль.
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
