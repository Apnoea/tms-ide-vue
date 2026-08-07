// Десктоп-обёртка IDE: окно + отдача собранной статики.
//
// Страница грузится НЕ через loadFile: `file://` даёт непрозрачный origin, а на
// нём Chromium отключает IndexedDB (весь персист проекта) и пикеры File System
// Access. Поэтому регистрируем привилегированную схему `app://` — у неё
// нормальный постоянный origin, и рендерер работает ровно как на localhost.
//
// CommonJS, а не ESM: в ESM-точке входа `electron` резолвится в npm-обёртку
// (она отдаёт путь к бинарнику), а не во встроенный модуль с API.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell } = require('electron')
const path = require('node:path')

// В упакованном виде статика лежит в app.asar/dist, в dev — в ../dist.
const distDir = path.join(__dirname, '..', 'dist')
const APP_ORIGIN = 'app://ide'
const SMOKE = process.argv.includes('--smoke')

// standard: URL разбирается как обычный (появляется origin), secure: доверенный
// контекст, supportFetchAPI: fetch/XHR к своим же ассетам.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

/** Путь внутри dist по URL запроса; всё вне dist отвергаем (анти-traversal). */
function resolveAsset(requestUrl) {
  const { pathname } = new URL(requestUrl)
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
  const full = path.join(distDir, rel)
  return full.startsWith(distDir) ? full : null
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#f8fafc',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // Показываем окно отрисованным — иначе видно белую вспышку.
  win.once('ready-to-show', () => win.show())

  // Внешние ссылки — в системный браузер, а не в окно приложения.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // DevTools мимо меню: F12 нужен и в упакованной сборке — иначе разбирать
  // «у меня не работает» на чужой машине нечем.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  guardClose(win)

  win.loadURL(`${APP_ORIGIN}/index.html`)
  if (SMOKE) runSmoke(win)
  return win
}

// Правки, не попавшие в выгруженный .zip. Флаг шлёт рендерер (dirtySinceExport);
// в браузере его показывает только амбер-точка на «Экспорт», а закрытие окна —
// операция необратимая, поэтому здесь спрашиваем явно.
let hasUnexported = false
ipcMain.on('tms:unexported', (_e, value) => {
  hasUnexported = !!value
})

/** Подтверждение закрытия при невыгруженных правках. */
function guardClose(win) {
  let confirmed = false
  win.on('close', async (event) => {
    if (confirmed || !hasUnexported || SMOKE) return
    event.preventDefault()
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Отмена', 'Закрыть без выгрузки'],
      defaultId: 0,
      cancelId: 0,
      title: 'Есть невыгруженные изменения',
      message: 'Изменения не попали в .zip',
      detail:
        'Проект останется в приложении и откроется при следующем запуске, ' +
        'но файл архива не будет содержать последних правок.',
    })
    if (response === 1) {
      confirmed = true
      win.close()
    }
  })
}

// `--smoke`: поднять окно, дождаться отрисовки и выйти с кодом. Нужен для CI —
// упаковка может пройти, а страница не подняться (битый путь к ассетам, CSP,
// origin), и без такой проверки это всплывёт только у пользователя.
function runSmoke(win) {
  const fail = (msg) => {
    console.error(`[smoke] ${msg}`)
    app.exit(1)
  }
  setTimeout(() => fail('таймаут: страница не отрисовалась'), 20000)
  win.webContents.on('did-fail-load', (_e, code, desc) =>
    fail(`загрузка не удалась: ${desc} (${code})`)
  )
  win.webContents.on('did-finish-load', async () => {
    try {
      // Ждём смонтированный Vue и рабочее хранилище: ради IndexedDB весь этот
      // протокол и заведён, а на непрозрачном origin она молча отвалилась бы.
      const ok = await win.webContents.executeJavaScript(`(async () => {
        const mounted = !!document.querySelector('#app')?.children.length
        let idb = false
        try {
          await new Promise((res, rej) => {
            const r = indexedDB.open('tms-smoke')
            r.onsuccess = () => { r.result.close(); indexedDB.deleteDatabase('tms-smoke'); res() }
            r.onerror = () => rej(r.error)
          })
          idb = true
        } catch { idb = false }
        return { mounted, idb, origin: location.origin }
      })()`)
      if (!ok.mounted) return fail('Vue не смонтирован')
      if (!ok.idb) return fail('IndexedDB недоступна')
      console.log(`[smoke] ok — origin ${ok.origin}, IndexedDB доступна`)
      app.exit(0)
    } catch (e) {
      fail(String(e?.message || e))
    }
  })
}

// Второй запуск не поднимает второе окно: IDE держит один проект, две копии
// писали бы в одно хранилище.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  app.whenReady().then(() => {
    // Меню убрано целиком: его акселераторы перехватывают клавиши РАНЬШЕ страницы,
    // а Ctrl+C/V/A/F у нас заняты холстом (см. useHotkeys). Правка текста в полях
    // не страдает — её обрабатывает сам Chromium. Заодно уходит Reload, стиравший
    // undo-историю случайным Ctrl+R.
    Menu.setApplicationMenu(null)

    protocol.handle('app', (request) => {
      const file = resolveAsset(request.url)
      if (!file) return new Response('forbidden', { status: 403 })
      return net.fetch(`file://${file.replace(/\\/g, '/')}`)
    })
    createWindow()
    // macOS: клик по иконке в доке при закрытых окнах.
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
