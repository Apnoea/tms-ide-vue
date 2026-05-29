/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
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
