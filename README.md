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
npm install
npm run dev       # http://localhost:5174/
npm run build     # production-сборка в dist/
npm test          # тесты однократно
npm run lint      # eslint
npm run knip      # неиспользуемые экспорты
```

## Структура

```
src/
├── main.js / App.vue / style.css
├── components/
│   ├── AppFooter.vue
│   ├── PalettePane.vue        # палитра стенсилов (слева)
│   ├── CanvasPane.vue         # JointJS-холст (центр)
│   ├── InspectorPane.vue      # инспектор (справа)
│   ├── ProjectActions.vue     # open / save / tag-list
│   ├── SearchBar.vue          # плавающий Ctrl+F-поиск
│   ├── VoltageSourceBlock.vue # карточка voltage-source
│   ├── SwitchBlock.vue        # карточка switch (intrinsic / source)
│   ├── AlarmSourceBlock.vue   # карточка cell_alr
│   ├── TagPickerDialog.vue    # picker тегов
│   └── HelpDialog.vue         # справка по хоткеям
├── composables/
│   ├── useCanvas.js           # singleton graph/paper/selection + search
│   ├── useAutosave.js         # localStorage autosave
│   ├── useUndoRedo.js         # snapshot-стек
│   ├── useClipboard.js        # copy / paste / duplicate
│   ├── useHotkeys.js          # единый keydown handler
│   ├── useNotify.js           # toast.add → notify.success/info/warn/error + TOAST_LIFE
│   ├── useSimulation.js       # preview-анимация
│   ├── useTextEdit.js         # inline edit cell_text
│   └── useBusResize.js        # drag-resize шины
├── stores/
│   ├── useUiStore.js          # dragging, helpOpen, searchOpen, tagListLoadRequest
│   └── useProjectStore.js     # tag-list + handle
├── stencils/
│   ├── registry.js            # авто-сборка через Vite glob
│   ├── parser.js              # {slot.X} интерполяция + injectIds
│   ├── linkDefaults.js        # router/connector для проводов
│   ├── svgInjector.js         # рендер SVG; программные билдеры bus/text/value
│   ├── tmsStencil.js          # dia.Element.define('tms.Stencil')
│   └── definitions/<id>/{stencil.json, shape.svg}
├── services/
│   ├── exporter.js            # view.svg + animations.json
│   ├── projectLoader.js       # round-trip load
│   ├── fileSystem.js          # File System Access API
│   └── parsers.js             # tag-list парсер
├── constants/
│   ├── animation.js           # voltage-палитра + CLASS_OFF / CLASS_HIDDEN
│   └── ids.js                 # wire-protocol: prefixes / data-attrs / slot resolver
└── utils/
    ├── cellSearch.js          # getCellTags(FromTms) + match для Ctrl+F
    ├── plural.js              # русские падежи
    ├── bridgeLinks.js         # bridge-link при copy/paste
    ├── grid.js                # snapToGrid
    ├── xml.js                 # SVG_NS + escapeXml / escapeAttr
    ├── switchSources.js       # normalizeSwitchSources { or, and } (Параллельно/Последовательно)
    ├── restoreGuard.js        # withRestoreGuard: try/finally вокруг restoringHistory
    └── idb.js                 # IndexedDB wrapper
```

Тесты лежат рядом с модулями (`*.test.js`); общий helper — `composables/test-utils.js`.

## Модель стенсила

Каждый стенсил — папка в `src/stencils/definitions/<id>/`:

- `stencil.json` — id, label, category, size, ports + опционально slots,
  animationTemplate, minWidth (только cell_bus)
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

### Декларативные флаги в stencil.json

Спец-поведение стенсила объявляется прямо в его JSON — exporter / Inspector /
Canvas читают флаги, никаких хардкод-списков в коде:

| Поле                   | Значение                                                                                | Где применяется                             |
| ---------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- |
| `quality: true`        | эмитит range-биндинг `[0,191] → animation-off` на outer                                 | cell_qr / cell_qk / cell_qf                 |
| `intrinsicOnoff: true` | `slot.onoff` неявно красит outer-wrapper серым на false                                 | cell_qw                                     |
| `layoutOnly: true`     | без visual-реакции на animation-классы; multi-select пропускает; detailTags не собирает | cell_text / cell_value                      |
| `noRotate: true`       | оверлей-кнопки rotate не рендерятся                                                     | cell_text / cell_value / cell_bus / cell_pi |
| `defaults: { ... }`    | merge в `tms` при создании ячейки                                                       | cell_text (`text`), cell_value (`valueTag`) |

Свойство «is switch» (рендер через SwitchBlock в intrinsic-режиме) выводится
по convention: стенсил с слотом `key === 'onoff'`. Helper `isSwitchStencil`.

### Стенсилы

| ID         | Категория        | Назначение                              |
| ---------- | ---------------- | --------------------------------------- |
| cell_text  | Текст и значения | Статический лейбл                       |
| cell_value | Текст и значения | Отображение значения тега               |
| cell_node  | Текст и значения | Точка соединения (наследует voltage)    |
| cell_tv2   | Трансформаторы   | Трансформатор (2 обмотки)               |
| cell_tv3   | Трансформаторы   | Трансформатор (3 обмотки)               |
| cell_qw    | Коммутация       | Выключатель (slot.onoff → off/cross)    |
| cell_qr    | Коммутация       | Отделитель (slot.onoff → open/closed)   |
| cell_qk    | Коммутация       | Короткозамыкатель (slot.onoff)          |
| cell_qf    | Коммутация       | Автоматический выключатель (slot.onoff) |
| cell_alr   | Сигналы          | Аварийный сигнал                        |
| cell_pi    | Измерения        | Счётчик электроэнергии (статичный)      |
| cell_bus   | Шины             | Шина (resizable, динамические порты)    |

`cell_bus`, `cell_text`, `cell_value` рендерятся программно (без `shape.svg`).

## Инспектор

При выделении ячейки в правой панели:

- **Стенсил** — id/label
- **Привязки тегов** — слоты стенсила (если есть)
- **Навигация** — свич + поле имени view для hyperlink при клике в рантайме
- **Анимации**:
  - **Voltage source** (range-биндинг, классы `animation-low/-mid/-high`)
  - **Switch source** — две секции зависимостей: «Параллельно» (любой замкнут →
    питание) и «Последовательно» (нужны все). Под напряжением =
    OR(Параллельно) ∨ AND(Последовательно); экспорт в `shape` либо
    `multi`-карточку (для OR/смешанного)
  - Intrinsic-блоки для cell_alr и для всех switch-стенсилов (cell_qw /
    cell_qr / cell_qk / cell_qf — convention `slot.key === 'onoff'`).
    SwitchBlock в intrinsic-режиме обёртывает slot.onoff.

При выделении провода — поле **Лейбл** (текст вдоль линии, ~10pt с белой
подложкой; JointJS labels на позиции 0.5 пути). `tms.label` — источник
правды, ищется в Ctrl+F.

В multi-select — массовое применение voltage/switch к выделению; стенсилы
с `layoutOnly: true` (cell_text / cell_value) автоматически пропускаются.

## Поиск (Ctrl+F)

Плавающий виджет ищет по: всем `slots.*`, `voltageSource.tag`,
`switchSources` (or + and), `valueTag`, тексту `cell_text`, `navigation`. Совпадения
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
  На каждой ячейке `id="animation-{stencilId}-{animId}"` + `data-tms-meta`
  (JSON для round-trip'а). cell_value сохраняет рантайм-конвенцию
  `id="animation-cell-{tag}"`. Провода — `<path id="animation-wire-{shortLinkId}">`.
- **animations.json** — мапа `id → card` для WebScada-рантайма.

cellId/linkId = JointJS UUID, стабилен между сессиями. Если у ячейки есть
`navigation`, animation-entry получает поле `"navigation": "view_id"` —
рантайм откроет указанную view при клике.

CSS в SVG:

- `*:not(text)` для `stroke` — текст не перекрашивается
- opt-in класс `.tms-voltage-fill` для заливки маркированных элементов
- `.animation-off` (slate-500) — поверх voltage-классов
- `.animation-hidden { display: none }`
- `[data-tms-stencil="..."].animation-off .animation-hidden { display: initial }`
  — генерится для каждого стенсила с `quality: true` (cell_qk / cell_qr /
  cell_qf). При bad-качестве показываем обе позиции рычага одновременно:
  «данные ненадёжны, не врём про конкретное состояние»

### Quality-биндинги

Для стенсилов с флагом `quality: true` в stencil.json (cell_qk / cell_qr /
cell_qf) exporter автоматически генерирует биндинг по каждому привязанному
тегу с `source: 'quality'` и кейсом `[0, 191] → addClass: animation-off`.
Рантайм при bad/uncertain quality (< 192) красит ячейку серым; CSS-override
выше показывает обе позиции рычага.

## Round-trip

Сохранённый `view.svg` открывается обратно через Ctrl+O — `projectLoader`
читает `data-tms-meta` и восстанавливает JointJS-граф. Один файл для
рантайма и для редактирования.
