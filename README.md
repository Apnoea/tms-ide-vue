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
│   ├── VoltageSourceBlock.vue # карточка-анимация «Источник напряжения»
│   ├── SwitchSourceBlock.vue  # карточка-анимация «Привязка к выключателю»
│   ├── BasePickerDialog.vue  # универсальный picker-модал (поиск + группировка)
│   ├── TagPickerDialog.vue   # обёртка над Base для выбора тегов
│   └── HelpDialog.vue        # справка по горячим клавишам
├── stores/
│   ├── useUiStore.js         # UI-state (dragging, dialogs, dark-mode)
│   └── useProjectStore.js    # проект (tag-list + handle)
├── composables/
│   └── useCanvas.js          # singleton-доступ к graph/paper/selection
├── services/
│   ├── exporter.js           # сборка view.svg + animations.json
│   ├── projectLoader.js      # round-trip: парсинг view.svg → JointJS cells
│   ├── fileSystem.js         # File System Access API (tag-list + svg-проект)
│   └── parsers.js            # парсинг tag-list
├── stencils/
│   ├── registry.js           # авто-сборка стенсилов через Vite glob imports
│   ├── parser.js             # подстановка {slot.X} в template + injectIds
│   ├── linkDefaults.js       # router/connector/attrs для проводов
│   ├── svgInjector.js        # рендер SVG стенсила в JointJS cellView;
│   │                         #   программные билдеры для cell_bus/text/value
│   └── definitions/<id>/{stencil.json, shape.svg}
├── constants/
│   ├── animation.js          # voltage-палитра + ANIMATION_OFF_COLOR
│   └── toast.js              # стандартные lifetime'ы toast'ов
└── utils/
    ├── plural.js / nplural   # русские падежи
    ├── bridgeLinks.js        # вычисление «мостов» при copy/paste
    └── idb.js                # минимальный IndexedDB-wrapper для file handles
```

Тесты лежат рядом с модулями: `*.test.js` (Vitest подхватывает автоматически).
Покрытие — чистые функции (parser, exporter, projectLoader, svg-инъекция, plural).

## Модель стенсила

Каждый стенсил живёт в `src/stencils/definitions/<id>/`:

- `stencil.json` — id, label, category, размеры, ports, slots, animationTemplate
- `shape.svg` — SVG-разметка с атрибутами `data-anim-suffix="..."` на
  элементах, которые анимируются (id'ы подставятся при инстанциации)

Добавление новой папки автоматически подтягивается реестром — перезапуск
не нужен.

### Слоты и привязка тегов

Стенсил декларирует **слоты** — именованные места под пользовательский
тег. Каждый слот:

```json
{
  "key": "onoff",              // ключ для подстановки {slot.KEY}
  "label": "Состояние ВКЛ/ВЫКЛ",
  "type": "Boolean",
  "required": true,
  "tagSuffix": ".ONOFF"        // фильтр picker'а (опционально)
}
```

В `animationTemplate.bindings.tag` используется placeholder `{slot.KEY}` —
при экспорте подставится тег, который юзер выбрал в инспекторе. Если слот
не выбран — биндинг отбрасывается (нет привязки = нет анимации, элемент
рендерится как статика).

Слоты заменили старую модель «префикс объекта + tagSuffixes regex» — теперь
тег = строка, которую юзер выбирает явно из tag-list'а; никакой автомагии
вокруг `{prefix}.SUFFIX` нет.

### Текущие стенсилы

- **cell_vk** — выключатель (slot.onoff)
- **cell_alr** — аварийный сигнал (slot.alr)
- **cell_rz** — разъединитель (без слотов, чисто визуальный)
- **cell_rzv** — заземлитель (без слотов)
- **cell_bus** — шина (resize по ширине, динамические порты каждые 20px)
- **cell_text** — текстовое поле (3 размера-пресет + bold)
- **cell_value** — отображение одного тега (label/единица по суффиксу)

`cell_bus`, `cell_text`, `cell_value` рендерятся программно через
`svgInjector.js` (без `shape.svg`), потому что их разметка параметризуется
(ширина / текст / выбранный тег).

## Анимации в инспекторе

В блоке «Анимации» инспектора отображаются три типа карточек:

- **A. Из стенсила** (read-only) — биндинги из `animationTemplate`,
  человеко-читаемые правила вида `PS031VK001.ONOFF = false → animation-off`
- **B. Источник напряжения** (`tms.voltageSource`) — range-биндинг на
  выбранный тег, классы `animation-low / -mid / -high` (Tailwind 500
  emerald/amber/red)
- **C. Привязка к выключателю** (`tms.switchSource`) — bool-биндинг,
  на `false` → `animation-off` (slate-500 серый)

B и C добавляются кнопками «+ Источник» / «+ Выключатель», удаляются
крестиком на карточке. Слоты (A) редактируются отдельным блоком «Привязки
тегов» — picker фильтруется по `tagSuffix` слота.

## Экспорт

`exportProject(graph)` собирает:

- **view.svg** — целостный SVG со всеми ячейками. На outer-wrapper'е каждой
  ячейки висит `id="animation-cell-{cellId}"` + `data-tms-meta` (JSON для
  round-trip'а в редактор). Провода — `<path id="animation-wire-{linkId}">`.
- **animations.json** — мапа `id → card` для WebScada-рантайма.
  `cellId`/`linkId` = JointJS UUID, стабилен между сессиями.

CSS-правила анимаций вшиваются в SVG как `<style>`:

- `*:not(text)` для `stroke` — текст не перекрашивается
- opt-in класс `.tms-voltage-fill` для заливки (только маркированные
  элементы — текст ячеек, точка восклицательного знака в cell_alr и т.п.)
- `.animation-off` — slate-500 серый стрелок поверх voltage-классов
- `.animation-hidden { display: none }`

## Round-trip

Сохранённый `view.svg` можно открыть обратно в IDE (Ctrl+O) — `projectLoader`
читает `data-tms-meta` JSON-атрибуты, восстанавливает JointJS-граф. Так
один файл служит и для рантайма, и для редактирования.
