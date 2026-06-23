/// <reference types="vitest/config" />
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Dev-плагин: приложение в браузере не может писать в исходники проекта, а
// при импорте проекта стенсилы должны физически лечь в src/stencils/definitions/
// (откуда их берёт Vite-glob реестра). Поэтому браузер шлёт стенсилы на этот
// эндпоинт, а dev-сервер (у него есть fs-доступ) пишет файлы; Vite-вотчер затем
// триггерит reload и реестр их подхватывает. Только dev (apply: 'serve').
// Контракт: POST /__stencils/import, тело [{ id, stencilJson, shapeSvg }];
// id — slug [a-z0-9_], путь жёстко ограничен definitions/ (анти-traversal).
const STENCIL_ID_RE = /^[a-z0-9_]+$/

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
  return {
    name: 'tms-stencil-write',
    apply: 'serve',
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
            await fs.writeFile(
              path.join(dir, 'stencil.json'),
              JSON.stringify(item.stencilJson ?? {}, null, 2) + '\n',
              'utf8'
            )
            await fs.writeFile(path.join(dir, 'shape.svg'), String(item.shapeSvg ?? ''), 'utf8')
            written.push(item.id)
          }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: true, written }))
        } catch (e) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }))
        }
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), stencilWritePlugin()],
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
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.js'],
  },
})
