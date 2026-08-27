import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  validateStencilJson,
  registerStencil,
  unregisterStencil,
  getStencilById,
  registryVersion,
  isHiddenStencil,
} from './registry'

// Минимальный валидный stencil — все required-поля. Используем как baseline,
// в каждом тесте только модифицируем нужное (валидный + 1 issue = чёткое
// сообщение в expect).
function validStencil(overrides = {}) {
  return {
    id: 'cell_x',
    label: 'Тест',
    category: 'Тест',
    width: 20,
    height: 20,
    shapeFile: 'shape.svg',
    ...overrides,
  }
}

const PATH = 'definitions/cell_x/stencil.json'

describe('validateStencilJson', () => {
  it('валидный stencil → пустой массив issues', () => {
    expect(validateStencilJson(PATH, validStencil())).toEqual([])
  })

  it('валидный stencil со всеми опциональными полями → пустой массив', () => {
    expect(
      validateStencilJson(
        PATH,
        validStencil({
          minWidth: 40,
          noRotate: true,
          noFlip: true,
          ports: [{ name: 'top', x: 10, y: 0 }],
          slots: [
            {
              key: 'onoff',
              type: 'Boolean',
            },
          ],
          animationTemplate: [
            { idSuffix: '.X', type: 'shape', bindings: [{ tag: '{slot.onoff}' }] },
          ],
        })
      )
    ).toEqual([])
  })

  it('каждое отсутствующее required-поле → issue', () => {
    const requiredFields = ['id', 'label', 'category', 'width', 'height', 'shapeFile']
    for (const field of requiredFields) {
      const stencil = validStencil()
      delete stencil[field]
      const issues = validateStencilJson(PATH, stencil)
      expect(issues.some((s) => s.includes(`отсутствует поле "${field}"`))).toBe(true)
    }
  })

  it('id вне маски [a-z0-9_] → issue', () => {
    const issues = validateStencilJson(PATH, validStencil({ id: 'Cell-X' }))
    expect(issues.some((s) => s.includes('вне маски'))).toBe(true)
  })

  it('опечатка в имени поля (slts вместо slots) → issue про неизвестное поле', () => {
    const issues = validateStencilJson(PATH, validStencil({ slts: [] }))
    expect(issues.some((s) => s.includes('неизвестное поле "slts"'))).toBe(true)
  })

  it('область применения: известная — молча, чужая и не-массив → issue', () => {
    // Ключ уезжает в фильтр палитры, а json приходит из чужого .zip: свободные
    // значения нанесли бы туда мусор, который нечем убрать.
    expect(validateStencilJson(PATH, validStencil({ domains: ['energy'] }))).toEqual([])
    expect(
      validateStencilJson(PATH, validStencil({ domains: ['plumbing'] })).some((s) =>
        s.includes('неизвестная область применения "plumbing"')
      )
    ).toBe(true)
    expect(
      validateStencilJson(PATH, validStencil({ domains: 'energy' })).some((s) =>
        s.includes('"domains" должен быть массивом')
      )
    ).toBe(true)
  })

  it('slot без key → issue', () => {
    const issues = validateStencilJson(PATH, validStencil({ slots: [{ label: 'X' }] }))
    expect(issues.some((s) => s.includes('slots[0] без "key"'))).toBe(true)
  })

  it('slot без label — не проблема (label необязателен, есть фолбэк в UI)', () => {
    const issues = validateStencilJson(PATH, validStencil({ slots: [{ key: 'x' }] }))
    expect(issues.some((s) => s.includes('slots[0] без "label"'))).toBe(false)
  })

  it('animationTemplate без idSuffix → issue', () => {
    const issues = validateStencilJson(
      PATH,
      validStencil({ animationTemplate: [{ type: 'shape' }] })
    )
    expect(issues.some((s) => s.includes('animationTemplate[0] без "idSuffix"'))).toBe(true)
  })

  it('animationTemplate без type → issue', () => {
    const issues = validateStencilJson(
      PATH,
      validStencil({ animationTemplate: [{ idSuffix: '.X' }] })
    )
    expect(issues.some((s) => s.includes('animationTemplate[0] без "type"'))).toBe(true)
  })

  it('idSuffix без соответствующего data-anim-suffix в shape.svg → issue', () => {
    const json = validStencil({
      animationTemplate: [
        { idSuffix: '.closed', type: 'shape' },
        { idSuffix: '.open', type: 'shape' },
      ],
    })
    // shape.svg только с одним из двух суффиксов — типичная опечатка после переименования
    const svg = '<svg><line data-anim-suffix=".closed"/></svg>'
    const issues = validateStencilJson(PATH, json, svg)
    expect(issues.some((s) => s.includes('.open') && s.includes('не найден в shape.svg'))).toBe(
      true
    )
    // Существующий суффикс не помечается
    expect(issues.some((s) => s.includes('.closed') && s.includes('не найден'))).toBe(false)
  })

  it('cross-check shape.svg пропускается если svgText не передан (svgText опционален)', () => {
    const json = validStencil({
      animationTemplate: [{ idSuffix: '.X', type: 'shape' }],
    })
    expect(validateStencilJson(PATH, json)).toEqual([])
  })

  it('animationTemplate с idSuffix="" (root-element) валиден — пустой суффикс это специально', () => {
    // idSuffix === '' валиден: для cell-уровневых биндингов суффикс пустой
    // → id="animation-{cellId}" без хвоста. Защита от undefined проверена выше.
    const issues = validateStencilJson(
      PATH,
      validStencil({ animationTemplate: [{ idSuffix: '', type: 'shape' }] })
    )
    expect(issues).toEqual([])
  })

  it('несколько проблем накапливаются в один массив', () => {
    const stencil = { id: 'x' } // нет почти всего + неизвестное поле
    stencil.unknown = true
    const issues = validateStencilJson(PATH, stencil)
    // 5 пропущенных required (label, category, width, height, shapeFile) + 1 unknown field
    expect(issues.length).toBeGreaterThanOrEqual(6)
  })

  it('каждое сообщение содержит путь к файлу (для удобной локализации в console)', () => {
    const issues = validateStencilJson('my/custom/path.json', { id: 'x' })
    expect(issues.length).toBeGreaterThan(0)
    for (const issue of issues) {
      expect(issue).toContain('my/custom/path.json')
    }
  })
})

describe('registerStencil', () => {
  it('добавляет символ в реестр со встроенным svgText (доступен через getStencilById)', () => {
    const id = 'cell_runtime_test'
    expect(getStencilById(id)).toBeUndefined()
    registerStencil({ id, label: 'RT', category: 'Тест', width: 20, height: 20 }, '<g/>')
    const s = getStencilById(id)
    expect(s.label).toBe('RT')
    expect(s.svgText).toBe('<g/>')
  })

  it('без id ничего не регистрирует (no-op)', () => {
    expect(registerStencil({ label: 'нет id' }, '<g/>')).toBe(false)
    expect(getStencilById(undefined)).toBeUndefined()
  })

  // id уезжает в data-tms-stencil и в CSS-селектор экспорта — реестр единственная
  // точка отсева, дальше по конвейеру id считается безопасным.
  it.each(['cell x', 'cell"x', 'Cell_X', 'cell]]>x', 'cell{x}', '../evil'])(
    'id вне маски (%s) отклоняется',
    (id) => {
      const before = registryVersion.value
      expect(
        registerStencil({ id, label: 'X', category: 'Т', width: 20, height: 20 }, '<g/>')
      ).toBe(false)
      expect(getStencilById(id)).toBeUndefined()
      expect(registryVersion.value).toBe(before)
    }
  )

  it('валидный id → true', () => {
    expect(
      registerStencil({ id: 'cell_ok_1', label: 'X', category: 'Т', width: 20, height: 20 }, '<g/>')
    ).toBe(true)
  })

  it('бампает registryVersion', () => {
    const before = registryVersion.value
    registerStencil({ id: 'cell_ver_test', label: 'V', category: 'Т', width: 20, height: 20 }, '')
    expect(registryVersion.value).toBe(before + 1)
  })
})

describe('unregisterStencil', () => {
  it('удаляет символ из реестра и бампает версию', () => {
    const id = 'cell_unreg_test'
    registerStencil({ id, label: 'U', category: 'Т', width: 20, height: 20 }, '<g/>')
    const before = registryVersion.value
    unregisterStencil(id)
    expect(getStencilById(id)).toBeUndefined()
    expect(registryVersion.value).toBe(before + 1)
  })

  it('удаление несуществующего id — версию не трогает (no-op)', () => {
    const before = registryVersion.value
    unregisterStencil('cell_does_not_exist_xyz')
    expect(registryVersion.value).toBe(before)
  })
})

describe('декл-флаги через registerStencil', () => {
  it('noRotate доезжает до реестра и виден потребителям', () => {
    // Путь «правка символа в редакторе»: buildStencilJson → registerStencil.
    // Флаг читают гейты холста (canCellRotate в useSelectionOverlay, rotateSelectedBy),
    // поэтому его потеря означала бы, что запрет поворота молча не работает.
    const id = 'cell_norotate_probe'
    expect(
      registerStencil(
        {
          id,
          label: 'Проба',
          category: 'Тест',
          width: 20,
          height: 20,
          shapeFile: 'shape.svg',
          noRotate: true,
        },
        '<svg xmlns="http://www.w3.org/2000/svg"><g></g></svg>'
      )
    ).toBe(true)
    expect(getStencilById(id).noRotate).toBe(true)
    unregisterStencil(id)
  })
})

describe('символы прошлого формата скрыты из палитры', () => {
  it('cell_node скрыт, даже когда чужой архив принёс своё определение', () => {
    // Проект приносит `library/cell_node/stencil.json` без наших флагов, и он
    // перекрывает встроенный — поэтому скрытость держится списком в коде, а не полем
    // в json: иначе символ возвращался бы в палитру после каждого импорта.
    expect(isHiddenStencil(getStencilById('cell_node'))).toBe(true)
    registerStencil(
      {
        id: 'cell_node',
        label: 'Точка соединения',
        category: 'Разметка и значения',
        width: 20,
        height: 20,
        shapeFile: 'shape.svg',
      },
      '<svg xmlns="http://www.w3.org/2000/svg"><g></g></svg>'
    )
    expect(isHiddenStencil(getStencilById('cell_node'))).toBe(true)
  })

  it('cell_text скрыт по той же причине — подпись стала фигурой-разметкой', () => {
    expect(isHiddenStencil(getStencilById('cell_text'))).toBe(true)
  })

  it('обычный символ остаётся видимым', () => {
    expect(isHiddenStencil(getStencilById('cell_qw'))).toBe(false)
  })
})

// Встроенные определения валидируем ПО ФАЙЛАМ, а не через реестр: реестр отдаёт уже
// разобранный объект, а здесь важно, что на диске нет полей вне `known`. Именно это
// ловит рассинхрон «код флаг больше не читает, а определение его держит» — такой
// коммит один раз уже уронил CI (снятый `resizeX` вернулся при откате папки).
describe('встроенные определения', () => {
  const DIR = 'src/stencils/definitions'
  const ids = readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)

  it('в definitions/ есть символы', () => {
    expect(ids.length).toBeGreaterThan(5)
  })

  it.each(ids)('%s: stencil.json без issues', (id) => {
    const path = `${DIR}/${id}/stencil.json`
    const json = JSON.parse(readFileSync(path, 'utf8'))
    let svgText = null
    try {
      svgText = readFileSync(`${DIR}/${id}/shape.svg`, 'utf8')
    } catch {
      // Программные символы (bus/value/node) рисуются кодом — shape.svg может не быть.
    }
    expect(validateStencilJson(path, json, svgText)).toEqual([])
  })
})
