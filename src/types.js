/**
 * JSDoc-типы для основных shape'ов проекта. Без миграции на TypeScript —
 * VS Code и любая IDE подхватывают эти typedef'ы для автодополнения и
 * проверки сигнатур. Файл сам ничего не экспортирует runtime'ом, только
 * декларации типов.
 *
 * Используй так:
 *   /** @type {import('../types').Stencil} *\/
 *   const stencil = getStencilById(id)
 *
 * При расширении модели — добавляй сюда, чтобы остаться единым источником
 * правды по структуре tms/stencil/animation.
 */

// ─── Tag-list ────────────────────────────────────────────────────────────

/**
 * Запись из tag-list'а. type — сырая строка из файла (Boolean/Real/Float/...).
 * @typedef {Object} Tag
 * @property {string} name   Полное имя тега (`PS031VK001.ONOFF`)
 * @property {string} type   Тип значения по tag-list'у
 */

// ─── Stencil definition (stencil.json) ──────────────────────────────────

/**
 * Слот стенсила — место для пользовательской привязки тега. Декларируется
 * в stencil.json, заполняется юзером в инспекторе.
 *
 * @typedef {Object} StencilSlot
 * @property {string} key                          Внутренний ID для {slot.KEY}
 * @property {string} label                        UI-надпись в инспекторе
 * @property {('Boolean'|'Real'|'Float'|'String')} [type]  Тип значения (для UX, не валидируем)
 * @property {boolean} [required]                  Required-слот пометится warning-badge'м
 * @property {string} [tagSuffix]                  Фильтр picker'а (`.ONOFF`)
 */

/**
 * Биндинг — одно правило «тег → CSS-класс». Заполняется в animationTemplate
 * стенсила; tag поддерживает интерполяцию `{slot.KEY}`.
 *
 * @typedef {Object} StencilBinding
 * @property {string} tag                              Тег или `{slot.KEY}` placeholder
 * @property {Object} [when]                           Условие применения (см. WebScada-runtime)
 * @property {string} when.source                     Обычно 'value'
 * @property {('map'|'range')} when.type
 * @property {Object|Array} when.cases                 map: {value: {apply}}; range: [{min,max,apply}]
 * @property {Object} [output]                         Для text-анимаций
 */

/**
 * Карточка анимации в animationTemplate стенсила.
 *
 * @typedef {Object} StencilAnimation
 * @property {string} idSuffix                        Дописывается к cellId для SVG-id (`animation-{cellId}{idSuffix}`)
 * @property {('shape'|'text')} type
 * @property {StencilBinding[]} [bindings]
 * @property {Object[]} [detailTags]                  Для контекстного меню в рантайме
 */

/**
 * Порт стенсила — точка для подключения проводов.
 *
 * @typedef {Object} StencilPort
 * @property {string} name
 * @property {number} x
 * @property {number} y
 * @property {string} [type]                          'io' и т.п. — пока чисто информационно
 */

/**
 * Целый стенсил из реестра.
 *
 * @typedef {Object} Stencil
 * @property {string} id                              Уникальный (cell_vk, cell_text, ...)
 * @property {string} label                           Палитра/инспектор
 * @property {string} category                       Группа в палитре
 * @property {string} version                         Семвер
 * @property {number} width                           Дефолтный размер в SVG-px
 * @property {number} height
 * @property {number} [minWidth]                     Для resizable (cell_bus)
 * @property {('horizontal'|'vertical')} [resizable]
 * @property {string} [defaultText]                  Для cell_text
 * @property {StencilSlot[]} [slots]
 * @property {StencilPort[]} [ports]
 * @property {StencilAnimation[]} [animationTemplate]
 * @property {string} shapeFile                       Имя файла рядом (shape.svg)
 * @property {string} svgText                         Загруженное содержимое shape.svg (через registry)
 */

// ─── Cell tms-payload (живёт на JointJS cell.attr('tms')) ───────────────

/**
 * Конфиг voltage-source — добавляется юзером, range-mapping тег → класс.
 *
 * @typedef {Object} VoltageRange
 * @property {number} min
 * @property {number} max
 * @property {string} class                         'animation-low' | 'animation-mid' | 'animation-high'
 */

/**
 * @typedef {Object} VoltageSource
 * @property {string} tag
 * @property {VoltageRange[]} ranges
 */

/**
 * Конфиг switch-source — bool-тег → класс `animation-off` при false.
 *
 * @typedef {Object} SwitchSource
 * @property {string} tag
 */

/**
 * Mета-данные на JointJS-cell'е. Используется и в редакторе, и в exporter'е,
 * и хранится в `data-tms-meta` для round-trip'а.
 *
 * @typedef {Object} TMSPayload
 * @property {string} stencilId                      Ссылка на Stencil.id из реестра
 * @property {Object<string,string>} [slots]         { onoff: 'PS031.ONOFF', ... }
 * @property {VoltageSource} [voltageSource]
 * @property {SwitchSource} [switchSource]
 * @property {string} [text]                         cell_text
 * @property {number} [fontSize]                     cell_text
 * @property {boolean} [bold]                        cell_text
 * @property {string} [valueTag]                     cell_value
 */

// ─── Selection / UI ──────────────────────────────────────────────────────

/**
 * Один элемент выделения. kind различает cell (стенсил) и link (провод) —
 * у них разные операции (например, slot picker только для cell).
 *
 * @typedef {Object} SelectionItem
 * @property {('cell'|'link')} kind
 * @property {string} id                             JointJS cell.id или link.id
 */

export {} // ensure ES-module mode; ничего не экспортируется в runtime
