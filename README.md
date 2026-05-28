# TMS IDE (Vue)

WEB IDE на Vue 3 для сборки SVG-мнемосхем SCADA из готовых стенсилов и
экспорта пары `view.svg` + `animations.json` для WebScada-рантайма.

## Стек

- **Vue 3.5** (Composition API, `<script setup>`)
- **Pinia 3** — state management
- **Vite 7** — build / dev
- **PrimeVue 4** с темой **Aura** (primary: cyan — emerald отдан анимации напряжения) — UI kit
- **Tailwind CSS 3** — layout / utility
- **@joint/core 4** (JointJS) — диаграммный движок (SVG-редактор)
- **Vitest 3 + jsdom** — unit-тесты для чистых модулей

## Запуск

```bash
yarn install
yarn dev          # dev-сервер на http://localhost:5174/
yarn build        # production-сборка в dist/
yarn test         # прогон тестов однократно
yarn test:watch   # watch-режим
```

## Структура

```
src/
├── main.js              # точка входа, регистрация Pinia + PrimeVue
├── App.vue              # корневой layout: header / splitters / footer
├── style.css            # Tailwind directives + JointJS-overrides
├── components/
│   ├── AppHeader.vue / AppFooter.vue
│   ├── PalettePane.vue       # палитра стенсилов (слева)
│   ├── CanvasPane.vue        # холст JointJS (центр)
│   ├── InspectorPane.vue     # инспектор выбранного элемента (справа)
│   ├── VoltageSourceBlock.vue # переиспользуемый блок «Источник напряжения»
│   ├── BasePickerDialog.vue  # универсальный picker-модал (поиск + группировка)
│   ├── PrefixPickerDialog.vue / TagPickerDialog.vue # обёртки над Base
│   └── HelpDialog.vue        # справка по горячим клавишам
├── stores/
│   ├── useUiStore.js         # UI-state (dragging, selection, dialogs)
│   └── useProjectStore.js    # проект (cells, tags, history, autosave)
├── composables/
│   └── useCanvas.js          # singleton-доступ к graph/paper/selection
├── services/
│   ├── exporter.js           # сборка view.svg + animations.json
│   ├── fileSystem.js         # File System Access API (загрузка tag-list)
│   └── parsers.js            # парсинг tag-list / project JSON
├── stencils/
│   ├── registry.js           # авто-сборка стенсилов через Vite glob imports
│   ├── parser.js             # подстановка {prefix} в template + injectIds
│   ├── svgInjector.js        # рендер SVG стенсила внутрь JointJS cellView,
│   │                         #   программные билдеры для cell_bus/text/value
│   ├── tagMatching.js        # фильтрация подходящих prefix'ов из tag-list
│   └── definitions/<id>/{stencil.json, shape.svg}
└── utils/                    # plural / nplural
```

Тесты лежат рядом с модулями: `*.test.js` (Vitest подхватывает автоматически).
Покрытие — чистые функции (парсеры, tag-matching, svg-инъекция, plural).

## Стенсилы

Каждый стенсил живёт в `src/stencils/definitions/<id>/`:

- `stencil.json` — id, label, category, tagPattern, tagSuffixes, размеры,
  порты, animationTemplate
- `shape.svg` — SVG-разметка с атрибутами `data-anim-suffix="..."` на
  элементах, которые анимируются (id'ы подставятся при экспорте)

Добавление новой папки автоматически подтягивается реестром — перезапуск
не нужен.

Текущие стенсилы:

- **cell_vk** — выключатель
- **cell_rz** — разъединитель
- **cell_rzv** — заземлитель
- **cell_bus** — шина (резайз по ширине, динамические порты каждые 20px)
- **cell_text** — текстовое поле (3 размера престе + bold)
- **cell_value** — отображение одного тега с суффиксом (.UA / .IA / итд)

`cell_bus`, `cell_text`, `cell_value` рендерятся программно через
`svgInjector.js` (без `shape.svg`), потому что их разметка параметризуется
(ширина / текст / выбранный суффикс).

## Анимация напряжения

В инспекторе у каждой ячейки / линии можно включить чекбокс
«Источник напряжения», выбрать тег и задать диапазоны → классы
(`animation-low` / `animation-mid` / `animation-high`). Экспортёр
прокидывает range-binding во все cards'ы префикса плюс на провода между
двумя «источниковыми» элементами (id вида `animation-wire-{prefixA}-{prefixB}`).

CSS-правила экспортируются в `view.svg` как `<style>`:

- `*:not(text)` для `stroke` — чтобы текст не перекрашивался
- opt-in класс `.tms-voltage-fill` для заливки (только rect/circle/ellipse/polygon/text)
