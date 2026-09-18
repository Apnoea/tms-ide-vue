/// <reference types="vitest/config" />
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig, normalizePath } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Dev-плагин: приложение в браузере не может писать в исходники проекта, а
// при импорте проекта стенсилы должны физически лечь в src/stencils/definitions/
// (откуда их берёт Vite-glob реестра). Поэтому браузер шлёт стенсилы на этот
// эндпоинт, а dev-сервер (у него есть fs-доступ) пишет файлы. Reload на свою же запись
// подавляется (см. handleHotUpdate): символ уже в рантайм-реестре. Только dev
// (apply: 'serve').
// Контракт: POST /__stencils/import, тело [{ id, stencilJson, shapeSvg }];
// id — slug [a-z0-9_], путь жёстко ограничен definitions/ (анти-traversal).
const STENCIL_ID_RE = /^[a-z0-9_]+$/

/** Текст файла с ровно одним завершающим переводом строки (канон для git-файлов). */
const withEol = (text) => `${String(text ?? '').replace(/\s*$/, '')}\n`

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : null)
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function stencilWritePlugin() {
  // Пути, только что записанные этим плагином: их hot-update глотаем (см.
  // handleHotUpdate). Ручную правку файла в редакторе кода это не затрагивает.
  const justWritten = new Set()
  const OWN_WRITE_MS = 3000

  // Ключ — путь в POSIX-виде: `path.join` на Windows даёт обратные слэши, а в
  // `handleHotUpdate` Vite отдаёт уже нормализованный путь, и Set бы не совпал.
  function markOwnWrite(file) {
    const key = normalizePath(file)
    justWritten.add(key)
    setTimeout(() => justWritten.delete(key), OWN_WRITE_MS).unref?.()
  }

  return {
    name: 'tms-stencil-write',
    apply: 'serve',
    /**
     * Сохранение символа пишет `definitions/<id>/*`, и вотчер Vite на это отвечает
     * полной перезагрузкой страницы: реестр собран `import.meta.glob`, hot-accept'а у
     * него нет. Перезагрузка тут лишняя — редактор уже зарегистрировал символ в
     * рантайме (`registerStencil`) и положил оверрайд в IDB, — а на экране она видна
     * морганием холста. Глотаем ТОЛЬКО свою запись: файл, правленый руками, по-прежнему
     * перезагружает страницу.
     */
    handleHotUpdate({ file }) {
      const key = normalizePath(file)
      if (!justWritten.has(key)) return
      justWritten.delete(key)
      return []
    },
    configureServer(server) {
      const defsDir = path.resolve(server.config.root, 'src/stencils/definitions')
      server.middlewares.use('/__stencils/import', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const body = await readJsonBody(req)
          const items = Array.isArray(body) ? body : []
          const written = []
          for (const item of items) {
            if (!item || !STENCIL_ID_RE.test(item.id || '')) continue
            const dir = path.resolve(defsDir, item.id)
            if (dir !== path.join(defsDir, item.id)) continue // анти-traversal
            await fs.mkdir(dir, { recursive: true })
            const jsonPath = path.join(dir, 'stencil.json')
            const svgPath = path.join(dir, 'shape.svg')
            markOwnWrite(jsonPath)
            markOwnWrite(svgPath)
            await fs.writeFile(
              jsonPath,
              JSON.stringify(item.stencilJson ?? {}, null, 2) + '\n',
              'utf8'
            )
            // Завершающий перевод строки добавляем ЗДЕСЬ, а не у отправителя: файл
            // пишут два пути — сохранение из редактора (serializeSvg, перевод есть) и
            // импорт .zip (разметка из реестра прошла XMLSerializer, перевода нет).
            // Без нормализации файл в git «дышал» последней строкой туда-сюда.
            await fs.writeFile(svgPath, withEol(item.shapeSvg), 'utf8')
            written.push(item.id)
          }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true, written }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
        }
      })

      // Удаление стенсила из палитры: сносим папку definitions/<id>/. id — тот
      // же slug-guard + жёсткое ограничение путём внутри defsDir (анти-traversal).
      server.middlewares.use('/__stencils/delete', async (req, res, next) => {
        if (req.method !== 'POST') return next()
        try {
          const body = await readJsonBody(req)
          const id = body?.id || ''
          const dir = path.resolve(defsDir, id)
          if (!STENCIL_ID_RE.test(id) || dir !== path.join(defsDir, id)) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: 'bad id' }))
            return
          }
          await fs.rm(dir, { recursive: true, force: true })
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
        }
      })
    },
  }
}

// Версия и дата сборки в UI (справка F1). Portable exe без установщика: если
// пользователь напишет «не работает», спросить его о версии больше негде.
// Дата — локальная, а не UTC: `toISOString` у вечерней сборки показал бы завтра.
const pkgVersion = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
).version
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const buildDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [vue(), tailwindcss(), stencilWritePlugin()],
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      output: {
        // Разбиваем vendor-код на параллельно-загружаемые чанки.
        // Без этого всё (vue + joint + primevue + наш app) едет одним 1.2MB
        // файлом, кэш на повторных деплоях рушится от любой правки app-кода.
        // Группы выбраны по «как часто меняются» — joint/primevue/vue апдейтятся
        // редко → их чанки переживают релизы и сидят в браузерном кэше.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@joint')) return 'joint'
          if (id.includes('primevue') || id.includes('@primeuix') || id.includes('primeicons')) {
            return 'primevue'
          }
          if (id.includes('/vue/') || id.includes('/pinia/') || id.includes('@vue/')) {
            return 'vue'
          }
        },
      },
    },
  },
  test: {
    // Дефолт — node: подъём jsdom стоит дороже самих тестов, а DOM нужен меньшинству
    // файлов — они помечены `// @vitest-environment jsdom` первой строкой.
    environment: 'node',
    include: ['src/**/*.{test,spec}.js'],
  },
})
