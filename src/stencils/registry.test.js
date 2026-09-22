import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import {
  validateStencilJson,
  registerStencil,
  unregisterStencil,
  getStencilById,
  isPresetStencil,
  nextStencilId,
  registryVersion,
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

  it('метка набора: валидная молчит, битая — предупреждение', () => {
    const preset = { id: 'demo', name: 'Демо', version: '1.0' }
    expect(validateStencilJson(PATH, validStencil({ preset }))).toEqual([])
    expect(validateStencilJson(PATH, validStencil({ preset: { id: 'demo' } }))).toEqual([
      expect.stringContaining('"preset"'),
    ])
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

// Метка набора — происхождение символа: по ней палитра прячет правку и удаление.
// Приходит из чужого .zip, поэтому нормализуется на входе в реестр.
describe('метка набора (preset)', () => {
  const base = { label: 'P', category: 'Т', width: 20, height: 20 }

  it('нормализуется: имя схлопывается, пустое заменяет id', () => {
    registerStencil(
      { ...base, id: 'demo_a', preset: { id: 'demo', name: '  Демо  набор ', version: '1.2.3' } },
      '<g/>'
    )
    expect(getStencilById('demo_a').preset).toEqual({
      id: 'demo',
      name: 'Демо набор',
      version: '1.2.3',
    })
    registerStencil({ ...base, id: 'demo_b', preset: { id: 'demo', version: '1' } }, '<g/>')
    expect(getStencilById('demo_b').preset.name).toBe('demo')
  })

  it.each([
    ['без версии', { id: 'demo' }],
    ['версия не по маске', { id: 'demo', version: '1.0-beta' }],
    ['id вне маски', { id: 'Demo Set', version: '1.0' }],
    ['не объект', 'demo'],
  ])('битая метка (%s) отбрасывается — символ пользовательский', (_, preset) => {
    registerStencil({ ...base, id: 'demo_bad', preset }, '<g/>')
    const s = getStencilById('demo_bad')
    expect(s.preset).toBeUndefined()
    expect(isPresetStencil(s)).toBe(false)
  })

  it('isPresetStencil: метка есть — символ из набора', () => {
    registerStencil(
      { ...base, id: 'demo_c', preset: { id: 'demo', name: 'Демо', version: '2.0' } },
      '<g/>'
    )
    expect(isPresetStencil(getStencilById('demo_c'))).toBe(true)
    expect(isPresetStencil(getStencilById('cell_qw'))).toBe(false)
    expect(isPresetStencil(undefined)).toBe(false)
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

// Имя копии предварительное (автор правит его до сохранения), но занятым быть не
// должно: иначе дубль перетёр бы чужой символ.
describe('nextStencilId', () => {
  it('свободное имя — `_copy`, занятое — со счётчиком', () => {
    expect(nextStencilId('cell_qw')).toBe('cell_qw_copy')
    registerStencil(
      { id: 'cell_qw_copy', label: 'C', category: 'Т', width: 20, height: 20 },
      '<g/>'
    )
    expect(nextStencilId('cell_qw')).toBe('cell_qw_copy2')
    unregisterStencil('cell_qw_copy')
  })

  it('копия копии не наращивает суффикс', () => {
    expect(nextStencilId('cell_qw_copy')).toBe('cell_qw_copy')
    expect(nextStencilId('cell_qw_copy7')).toBe('cell_qw_copy')
  })

  it('имя остаётся в маске id (латиница, цифры, _)', () => {
    expect(nextStencilId('cell_qw')).toMatch(/^[a-z0-9_]+$/)
    expect(nextStencilId(undefined)).toBe('cell_copy')
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

describe('символов прошлого формата в реестре нет', () => {
  it('cell_node и cell_text не зарегистрированы', () => {
    // Оба — не символы: точку рисует свободный конец провода (legacyFormat
    // .dissolveNodeCells), подпись отбрасывается на загрузке (dropTextCells).
    expect(getStencilById('cell_node')).toBeUndefined()
    expect(getStencilById('cell_text')).toBeUndefined()
  })
})

// Встроенные определения валидируются ПО ФАЙЛАМ, а не через реестр: тот отдаёт уже
// разобранный объект, а здесь важно, что на диске нет полей вне `known`. Так ловится
// рассинхрон «код флаг больше не читает, а определение его держит».
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
