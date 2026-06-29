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
│   ├── StatusBar.vue          # справка F1 (верх справа)
│   ├── FormTabs.vue           # вкладки форм (браузер-стиль, над холстом)
│   ├── PalettePane.vue        # палитра стенсилов (слева)
│   ├── CanvasPane.vue         # JointJS-холст (центр)
│   ├── InspectorPane.vue      # инспектор (справа)
│   ├── ProjectActions.vue     # открыть/экспортировать проект (топ-бар)
│   ├── TagListControl.vue     # загрузка tag-list + счётчик (тулбар холста)
│   ├── SaveIndicator.vue      # индикатор автосейва (слева-снизу холста)
│   ├── SearchBar.vue          # плавающий Ctrl+F-поиск
│   ├── VoltageSourceBlock.vue # карточка «Диапазоны значений» (аналог. источник)
│   ├── SwitchBlock.vue        # карточка «Булев источник» (intrinsic + зависимости)
│   ├── AlarmSourceBlock.vue   # карточка cell_alr
│   ├── TagPickerDialog.vue    # picker тегов
│   └── HelpDialog.vue         # справка по хоткеям
├── composables/
│   ├── useCanvas.js           # singleton graph/paper/selection + search
│   ├── useAutosave.js         # персист проекта (формы) в IndexedDB + restore
│   ├── useUndoRedo.js         # snapshot-стек
│   ├── useClipboard.js        # copy / paste / duplicate
│   ├── useHotkeys.js          # единый keydown handler
│   ├── useNotify.js           # toast.add → notify.success/info/warn/error + TOAST_LIFE
│   ├── useSimulation.js       # preview-анимация
│   ├── useTextEdit.js         # inline edit cell_text
│   ├── useBusResize.js        # drag-resize шины
│   ├── useWireSplice.js       # врезка стенсила в провод + превью над проводом
│   ├── useProject.js          # оркестрация: переключение / CRUD форм / импорт / экспорт
│   ├── usePan.js / useLasso.js # pan холста / рамочное выделение (Alt+ЛКМ)
│   ├── usePaletteDrag.js      # drag стенсила из палитры (превью + создание + врезка)
│   ├── useContextMenu.js      # контекстное меню холста
│   ├── useHoverTooltip.js     # hover-плашка ячейки
│   ├── useSlotWarnings.js     # бейджи незаполненных required-слотов
│   └── useSelectionOverlay.js # overlay-кнопки выделенной ячейки (rotate/delete)
├── stores/
│   ├── useUiStore.js          # dragging, helpOpen, searchOpen, tagListLoadRequest
│   ├── useProjectStore.js     # tag-list + handle
│   └── useWorkspaceStore.js   # формы проекта + активная форма
├── stencils/
│   ├── registry.js            # авто-сборка через Vite glob
│   ├── parser.js              # {slot.X} интерполяция + injectIds
│   ├── linkDefaults.js        # router/connector для проводов
│   ├── svgInjector.js         # рендер SVG; программные билдеры bus/text/value
│   ├── tmsStencil.js          # dia.Element.define('tms.Stencil')
│   └── definitions/<id>/{stencil.json, shape.svg}
├── services/
│   ├── exporter.js            # view.svg + animations.json (пер-форма)
│   ├── projectLoader.js       # round-trip load (parseSvgProject)
│   ├── projectIO.js           # импорт/экспорт папки проекта (FSA)
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
    ├── wireSplice.js          # врезка (pickPassThroughPorts/spliceRotation) + срастание (planWireBridge)
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
  "label": "Основной выключатель",
  "type": "Boolean",
  "required": true
}
```

В `animationTemplate.bindings.tag` — placeholder `{slot.KEY}`. При экспорте
подставится выбранный тег. Слот без значения → биндинг отбрасывается.

Picker слота фильтрует теги по `type`: булевы слоты (`type: Boolean`) — только
bool-теги из tag-list (по типу, не по суффиксу имени). Раньше фильтр был по
суффиксу (`.ONOFF` / `.ALR`) — убран как ненадёжный (имя ≠ тип).

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
- **Навигация** — свич + выбор формы-цели для hyperlink при клике в рантайме
  (список форм проекта, не свободный ввод; цель, которой нет в проекте,
  подсвечивается как битая)
- **Анимации** — оба блока видны всегда (без кнопок «добавить»), пустой блок =
  тег не выбран; данные пишутся лениво при выборе тега/диапазона, очищаются через ×:
  - **Диапазоны значений** — аналоговый тег,
    range-биндинг, классы `animation-low/-mid/-high`. Picker без фильтра по типу.
  - **Булев источник** — две секции
    зависимостей: «Последовательно» (нужны все = true) и «Параллельно» (достаточно
    любого = true). Активен = AND(Последовательно) ∨ OR(Параллельно); экспорт в
    `shape` либо `multi`-карточку (для OR/смешанного). Picker — только bool-теги.
  - Для cell_alr — только его alarm-слот (общий булев блок скрыт); для switch-стенсилов
    (cell_qw / cell_qr / cell_qk / cell_qf — convention `slot.key === 'onoff'`)
    булев блок включает intrinsic slot.onoff первой строкой.

В multi-select те же блоки работают как «применить ко всем»: булев тег раздаётся
в выбранную секцию всех выделенных; «Диапазоны значений» — это шаблон (тег +
пороги), любая правка раздаётся на всё выделение. Стенсилы с `layoutOnly: true`
(cell_text / cell_value) пропускаются.

## Поиск (Ctrl+F)

Плавающий виджет ищет по: всем `slots.*`, `voltageSource.tag`,
`switchSources` (or + and), `valueTag`, тексту `cell_text`, `navigation`. Совпадения
подсвечиваются амбер-ореолом, текущее — насыщенный оранжевый, паном
центрируется в viewport (если за пределами). Enter/F3 — следующее,
Shift+Enter/F3 — предыдущее, Esc — закрыть.

## Холст: порты по ховеру

Порты ячеек по умолчанию скрыты, проявляются при наведении на ячейку
(или когда она выделена) — наводишь на элемент, видишь куда тянуть провод.
Чистый CSS (`.joint-element:hover` / `.tms-selected`), без JS.

## Холст: врезка и срастание проводов

**Врезка** — drop стенсила с **≥2 портами** из палитры на провод разбивает его
на два сегмента с проходом через элемент: исходный линк переиспользуется как
`source→cell.in`, добавляется `cell.out→target` с клоном анимаций; элемент
наследует voltage/switch провода (но его собственная конфигурация приоритетнее —
наследуется только то, чего у него нет). Во время drag над проводом превью липнет
к линии и поворачивается под угол врезки.

- Угол врезки (`utils/wireSplice.js` → `spliceRotation`): пара проходных портов
  выравнивается вдоль **локального сегмента** провода в точке врезки (касательная
  `wireDirAt`, не линия центров — rightAngle-роутер гнёт провод). Для 2-портовых
  из двух вариантов (±180°) сторона курсора выбирает разворот: на горизонтальном
  сегменте курсор выше → по часовой, ниже → против; на вертикальном слева → как
  есть, справа → 180°.
- Выбор пары портов (`pickPassThroughPorts`) — тоже вдоль локального сегмента.
- Ручные изломы провода распределяются по сегментам относительно точки врезки
  (по длине вдоль пути): что было до неё — остаётся на первом сегменте, что после
  — переезжает на второй.

Вся геометрия/топология врезки и превью живёт в `composables/useWireSplice.js`
(чистые функции — в `utils/wireSplice.js`).

**Срастание** — удаление **одного** элемента, через который проходят ровно
**2 провода к 2 разным соседям**, объединяет их в один (вместо разрыва): выживший
линк перецеливается на дальний конец второго ещё до удаления (иначе каскад
JointJS снёс бы оба). Логика — `utils/wireSplice.js` → `planWireBridge`;
применяется в `useCanvas.deleteItems` (через него идут все пути удаления: Del,
контекстное меню, оверлей-кнопка, инспектор). Изломы обоих проводов сшиваются в
один список (с учётом порядка и реверса). В multi-select срастание НЕ делаем —
туда авто-попадают мостовые провода между ячейками, сохранять нечего.

## Холст: ручные изломы провода

У выделенного провода доступен тул `linkTools.Vertices`: drag по линии создаёт
излом, drag по излому двигает маршрут, double-click добавляет точку,
`redundancyRemoval` убирает излом, легший на прямую между соседями. Изломы
снапятся к сетке (`change:vertices`-хендлер) — край не отрывается от линии,
которую держит на сетке `gridRightAngleRouter` (snap-обёртка над `rightAngle`).
Роутеру нужен `useVertices: true`, иначе `rightAngle` игнорирует изломы.
Эндпоинт-ручки реконнекта рендерятся **поверх** vertex-adding обёртки (порядок
тулов), иначе клик у конца провода добавлял бы излом вместо перемещения. Изломы
переживают round-trip через `data-tms-meta`.

## Холст: ресайз шины

Шина (`cell_bus`) тянется за edge-хэндлы. Резайз через нативный
`cell.resize(w, h, { direction })` (`useBusResize`): `direction:'right'` держит
левый край, `'left'` — правый. Ширина снапится к `BUS_PORT_SPACING` (20) — один
шаг = один слот порта. При резайзе **влево** origin уезжает, поэтому порт-рефы
подключённых линков сдвигаются на число слотов (`top_i → top_(i+k)`) — порты не
пересоздаются, абсолютные позиции подключённых проводов сохраняются.

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

`view.svg` каждой формы открывается обратно — `projectLoader` читает
`data-tms-meta` и восстанавливает JointJS-граф. Один файл для рантайма и для
редактирования.

## Проект (формы + библиотека)

IDE работает с **проектом** — набором форм (схем) + библиотекой стенсилов.
Открыта одна форма; формы — вкладки (браузер-стиль) над холстом (клик → форма
на холсте). Состояние проекта (формы пер-id, активная, теги) хранится в
IndexedDB и переживает перезагрузку.

- **Формы** — вкладки над холстом: «+» создаёт пустую, двойной клик по вкладке —
  переименование, × на вкладке — удаление (единственную удалить нельзя). Имя
  формы = имя папки при экспорте = цель навигации, поэтому переименование заодно
  чинит ссылки `tms.navigation` на старое имя во всех формах.
- **Открыть проект** (`Ctrl+O`) — выбрать папку через File System Access:
  `forms/<id>/view.svg` → формы, `library/<id>/{stencil.json,shape.svg}` →
  стенсилы, `taglist.csv` → теги. Новые (не из реестра) стенсилы регистрируются
  в рантайме сразу, поэтому форма рисуется без ожидания reload; параллельно их
  файлы дописываются в `src/stencils/definitions/` (см. ниже) для персистентности
  — Vite-reload при этом опционален. Стенсилы, которых нет ни в базе, ни в бандле,
  попадают в предупреждение. Пустые формы (заготовки, цели навигации) сохраняются —
  отбрасывается только битый SVG. Если запись в IndexedDB не прошла целиком (квота),
  импорт сообщает об этом и не перезагружает страницу.
- **Экспортировать проект** (`Ctrl+S`) — в папку проекта (запоминается, пишет
  туда же без повторного выбора): по форме `view.svg`+`animations.json`,
  используемые стенсилы в `library/`, `taglist.csv`. Геометрия проводов снимается
  с реально отрисованного paper (формы прогоняются через холст под оверлеем).
- **Стенсилы — физические файлы** в `src/stencils/definitions/` (Vite-glob).
  Персистентный реестр — статичный glob; при импорте новые стенсилы пишет
  dev-плагин (`vite.config.js`, `POST /__stencils/import`) — браузер сам в
  исходники писать не может, а `registerStencil` лишь транзитно держит их в
  реестре до reload. Существующие стенсилы не перезаписываются (нет git-шума).
