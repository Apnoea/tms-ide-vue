// Иконка приложения из public/favicon.svg. Запускается вручную при смене
// логотипа: `npm run icon:build`. Рендерим самим Electron (он уже в devDeps) —
// иначе ради разовой операции пришлось бы тащить sharp/imagemagick.
//
// На выходе build/icon.png 512×512 с прозрачным фоном: из него electron-builder
// делает .ico для Windows, а Linux/AppImage берёт png как есть.
//
// Рисуем через canvas в рендерере, а не capturePage: offscreen-съёмка окна
// приносит полосы прокрутки и подвисает без GPU, а тут результат детерминирован.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const SIZE = 512
const root = path.join(__dirname, '..')
const src = path.join(root, 'public', 'favicon.svg')
const outDir = path.join(root, 'build')
const out = path.join(outDir, 'icon.png')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const svg = fs.readFileSync(src, 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  await win.loadURL('data:text/html;charset=utf-8,<meta charset="utf-8">')

  const dataUrl = await win.webContents.executeJavaScript(`(async () => {
    const svg = ${JSON.stringify(svg)}
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.width = img.height = ${SIZE}
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url })
    const c = document.createElement('canvas')
    c.width = c.height = ${SIZE}
    c.getContext('2d').drawImage(img, 0, 0, ${SIZE}, ${SIZE})
    return c.toDataURL('image/png')
  })()`)

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`[icon] ${path.relative(root, out)} — ${SIZE}px`)
  app.exit(0)
})
