// Flat ESLint config (ESLint 9+). Минимальный набор правил под Vue 3 проект.
// Цель — ловить РУТИНУ: unused imports/vars, опечатки в именах, broken
// vue-template. Стилистические правила (отступы, кавычки) НЕ включаем —
// они доставляют шума больше чем пользы при solo-работе.

import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import prettierConfig from 'eslint-config-prettier'

export default [
  // Полностью игнорируем сторонний/сгенерированный код
  {
    ignores: ['dist/', 'node_modules/', '*.min.js'],
  },

  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  // Отключаем стилистические ESLint-правила в пользу prettier.
  prettierConfig,

  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // ─── Что ловим ───
      // Unused vars/imports — главная цель. Аргументы с префиксом _ игнорируем
      // (общая JS-конвенция «specified-on-purpose-but-unused»).
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Вьюшные баги, которые приводят к runtime-сюрпризам
      'vue/no-unused-components': 'warn',
      'vue/no-unused-vars': 'warn',

      // ─── Что НЕ ловим (отключаем шум) ───
      // У нас стенсилы id'шники snake_case (cell_vk, cell_text). PrimeVue
      // компоненты тоже single-word через alias (Button, Tag). Правило про
      // multi-word имена не применимо.
      'vue/multi-word-component-names': 'off',
      // Атрибуты в template могут идти в любом порядке — рисовать UX часто
      // удобнее с :class в начале, а не там где правило хочет.
      'vue/attributes-order': 'off',
      // self-closing — стиль, не баг
      'vue/html-self-closing': 'off',
      // Длинные строки и форматирование template — не наша забота
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-indent': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-spacing': 'off',

      // v-html опасен XSS-ом только если в него идёт юзерский ввод. У нас
      // все usages — bundled SVG из stencil.svg файлов (build-time trusted).
      // Отключаем globally чтобы не плодить eslint-disable-next-line.
      'vue/no-v-html': 'off',
    },
  },

  // Тесты — vitest вводит globals describe/it/expect, чтобы no-undef не ругался
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]
