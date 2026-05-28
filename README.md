# TMS IDE (Vue)

WEB IDE на Vue 3 для сборки SVG-мнемосхем SCADA из готовых стенсилов и
экспорта пары `view.svg` + `animations.json` для WebScada-рантайма.

Заменяет прототип `tms-ide-web` (React). Концепт — см. [CONCEPT_IDE.md](../CONCEPT_IDE.md) в корне репозитория TMS.

## Стек

- **Vue 3** (Composition API)
- **Pinia** — state management
- **Vite** — build / dev
- **PrimeVue 4** с темой **Aura** — UI kit
- **Tailwind CSS** — layout / utility
- **JointJS Core** — диаграммный движок (SVG-редактор)

## Запуск

```bash
yarn install
yarn dev
```

Dev-сервер: `http://localhost:5174/` (порт отличается от React-прототипа,
чтобы можно было держать оба запущенными).

Production-сборка: `yarn build` → `dist/`.

## Структура

```
src/
├── main.js              # точка входа, регистрация Pinia + PrimeVue
├── App.vue              # корневой layout: header / splitters / footer
├── style.css            # Tailwind directives + JointJS-overrides
├── components/          # AppHeader/Footer, Palette/Canvas/Inspector, диалоги
├── stores/              # Pinia-сторы (ui, project)
├── composables/         # useCanvas — shared доступ к graph/paper/selection
├── services/            # exporter, fileSystem, parseTagList
├── stencils/
│   ├── registry.js      # авто-сборка стенсилов через Vite glob imports
│   ├── parser.js        # подстановка {prefix} в template + injectIds в SVG
│   ├── svgInjector.js   # рендер SVG стенсила внутрь JointJS cellView
│   ├── tagMatching.js   # фильтрация подходящих prefix'ов из tag-list
│   └── definitions/<id>/{stencil.json, shape.svg}
└── utils/               # plural / nplural
```

## Стенсилы

Каждый стенсил живёт в `src/stencils/definitions/<id>/`:

- `stencil.json` — id, label, category, tagPattern, tagSuffixes, размеры,
  порты, animationTemplate
- `shape.svg` — SVG-разметка с атрибутами `data-anim-suffix="..."` на
  элементах, которые анимируются (id'ы подставятся при экспорте)

Добавление новой папки автоматически подтягивается реестром — перезапуск
не нужен.
