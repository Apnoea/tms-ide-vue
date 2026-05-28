/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.js'],
  },
})
