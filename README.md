# TMS IDE (Vue)

Web IDE на Vue 3 для сборки SVG-мнемосхем SCADA и экспорта пары
`view.svg` + `animations.json` для WebScada-рантайма.

## Стек

- **Vue 3.5** (Composition API, `<script setup>`)
- **Pinia 3** — state management
- **Vite 7** — build / dev
- **PrimeVue 4** (Aura, primary cyan) — UI kit
- **Tailwind CSS 3** — layout / utility
- **@joint/core 4** (JointJS) — SVG-редактор
- **Vitest 3 + jsdom** — unit-тесты

## Запуск

```bash
yarn install
yarn dev          # http://localhost:5174/
yarn build        # production-сборка в dist/
yarn test         # тесты однократно
yarn lint         # eslint
```

## Структура

```
src/
├── main.js / App.vue / style.css
├── components/
│   ├── AppHeader.vue / AppFooter.vue
│   ├── PalettePane.vue        # палитра стенсилов (слева)
│   ├── CanvasPane.vue         # JointJS-холст (центр)
│   ├── InspectorPane.vue      # инспектор (справа)
│   ├── SearchBar.vue          # плавающий Ctrl+F-поиск
│   ├── VoltageSourceBlock.vue # карточка voltage-source
│   ├── SwitchBlock.vue        # карточка switch (intrinsic / source)
│   ├── AlarmSourceBlock.vue   # карточка cell_alr
│   ├── TagPickerDialog.vue    # picker тегов
│   └── HelpDialog.vue         # справка по хоткеям
├── composables/
│   └── useCanvas.js           # singleton-доступ к graph/paper/selection + search
├── stores/
│   ├── useUiStore.js          # dragging, helpOpen, searchOpen, darkMode
│   └── useProjectStore.js     # tag-list + handle
├── stencils/
│   ├── registry.js            # авто-сборка через Vite glob
│   ├── parser.js              # {slot.X} интерполяция + injectIds
│   ├── linkDefaults.js        # router/connector для проводов
│   ├── svgInjector.js         # рендер SVG; программные билдеры bus/text/value
│   └── definitions/<id>/{stencil.json, shape.svg}
├── services/
│   ├── exporter.js            # view.svg + animations.json
│   ├── projectLoader.js       # round-trip load
│   ├── fileSystem.js          # File System Access API
│   └── parsers.js             # tag-list парсер
├── constants/
│   ├── animation.js           # voltage-палитра + ANIMATION_OFF_COLOR
│   └── toast.js               # стандартные lifetime'ы
└── utils/
    ├── cellSearch.js          # collect-strings + match для Ctrl+F
    ├── plural.js              # русские падежи
    ├── bridgeLinks.js         # bridge-link при copy/paste
    └── idb.js                 # IndexedDB wrapper
```

Тесты лежат рядом с модулями (`*.test.js`).

## Модель стенсила

Каждый стенсил — папка в `src/stencils/definitions/<id>/`:

- `stencil.json` — id, label, category, size, ports, slots, animationTemplate
- `shape.svg` — SVG c атрибутами `data-anim-suffix` на анимируемых элементах

Реестр строится автоматически (Vite glob), перезапуск не нужен.

### Слоты

```json
{
  "key": "onoff",
  "label": "Состояние ВКЛ/ВЫКЛ",
  "type": "Boolean",
  "required": true,
  "tagSuffix": ".ONOFF"
}
```

В `animationTemplate.bindings.tag` — placeholder `{slot.KEY}`. При экспорте
подставится выбранный тег. Слот без значения → биндинг отбрасывается.

### Стенсилы

| ID         | Категория        | Назначение                           |
| ---------- | ---------------- | ------------------------------------ |
| cell_text  | Текст и значения | Статический лейбл                    |
| cell_value | Текст и значения | Отображение значения тега            |
| cell_tn2   | Измерения        | Трансформатор напряжения (2ф)        |
| cell_tn3   | Измерения        | Трансформатор напряжения (3ф)        |
| cell_vk    | Коммутация       | Выключатель                          |
| cell_rz    | Коммутация       | Разъединитель                        |
| cell_rzv   | Коммутация       | Заземлитель                          |
| cell_alr   | Сигналы          | Аварийный сигнал                     |
| cell_bus   | Шины             | Шина (resizable, динамические порты) |

`cell_bus`, `cell_text`, `cell_value` рендерятся программно (без `shape.svg`).

## Инспектор

При выделении ячейки в правой панели:

- **Стенсил** — id/label
- **Привязки тегов** — слоты стенсила (если есть)
- **Навигация** — свич + поле имени view для hyperlink при клике в рантайме
- **Анимации**:
  - **Voltage source** (range-биндинг, классы `animation-low/-mid/-high`)
  - **Switch source** (bool-биндинг, `false` → `animation-off`)
  - Intrinsic-блоки для cell_alr / cell_vk (обёртки над required-слотом)

В multi-select — массовое применение voltage/switch к выделению; `cell_text` /
`cell_value` автоматически пропускаются.

## Поиск (Ctrl+F)

Плавающий виджет ищет по: всем `slots.*`, `voltageSource.tag`,
`switchSource.tag`, `valueTag`, тексту `cell_text`, `navigation`. Совпадения
подсвечиваются амбер-ореолом, текущее — насыщенный оранжевый, паном
центрируется в viewport (если за пределами). Enter/F3 — следующее,
Shift+Enter/F3 — предыдущее, Esc — закрыть.

## Холст: proximity-портов

Порты ячеек по умолчанию скрыты, проявляются по расстоянию от курсора
(`opacity = max(0, 1 - 0.2 × cells)`): 0 клеток = 100%, 2 = 60%, 4 = 20%,
≥5 = 0. У выделенной ячейки порты видны полностью.

## Экспорт

`exportProject(graph)` собирает:

- **view.svg** — целостный SVG с inline `<style>` для animation-классов.
  На каждой ячейке `id="animation-cell-{cellId}"` + `data-tms-meta` (JSON
  для round-trip'а). Провода — `<path id="animation-wire-{linkId}">`.
- **animations.json** — мапа `id → card` для WebScada-рантайма.

cellId/linkId = JointJS UUID, стабилен между сессиями. Если у ячейки есть
`navigation`, animation-entry получает поле `"navigation": "view_id"` —
рантайм откроет указанную view при клике.

CSS в SVG:

- `*:not(text)` для `stroke` — текст не перекрашивается
- opt-in класс `.tms-voltage-fill` для заливки маркированных элементов
- `.animation-off` (slate-500) — поверх voltage-классов
- `.animation-hidden { display: none }`

## Round-trip

Сохранённый `view.svg` открывается обратно через Ctrl+O — `projectLoader`
читает `data-tms-meta` и восстанавливает JointJS-граф. Один файл для
рантайма и для редактирования.
