// Минимальная key-value обёртка над IndexedDB. Хранит то, что localStorage не
// тянет: FileSystemFileHandle tag-list'а (не сериализуется в JSON — браузер
// держит как ссылку, см. ProjectActions) и проект (формы/мета — крупнее квоты
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

export async function idbGet(key) {
  try {
    const db = await openDB()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

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
  } catch {
    /* ignore — quota / private mode */
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
