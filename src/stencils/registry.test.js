import { describe, it, expect } from 'vitest'
import { validateStencilJson } from './registry'

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
          ports: [{ name: 'top', x: 10, y: 0 }],
          slots: [
            {
              key: 'onoff',
              label: 'ВКЛ/ВЫКЛ',
              type: 'Boolean',
              required: true,
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

  it('опечатка в имени поля (slts вместо slots) → issue про неизвестное поле', () => {
    const issues = validateStencilJson(PATH, validStencil({ slts: [] }))
    expect(issues.some((s) => s.includes('неизвестное поле "slts"'))).toBe(true)
  })

  it('slot без key → issue', () => {
    const issues = validateStencilJson(PATH, validStencil({ slots: [{ label: 'X' }] }))
    expect(issues.some((s) => s.includes('slots[0] без "key"'))).toBe(true)
  })

  it('slot без label → issue', () => {
    const issues = validateStencilJson(PATH, validStencil({ slots: [{ key: 'x' }] }))
    expect(issues.some((s) => s.includes('slots[0] без "label"'))).toBe(true)
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

  it('cross-check shape.svg пропускается если svgText не передан (backward-compat)', () => {
    const json = validStencil({
      animationTemplate: [{ idSuffix: '.X', type: 'shape' }],
    })
    expect(validateStencilJson(PATH, json)).toEqual([])
  })

  it('animationTemplate с idSuffix="" (root-element) валиден — пустой суффикс это специально', () => {
    // idSuffix === '' тоже валиден (root-anim-target, например cell_alr раньше
    // использовал ".ALR", но для cell-уровневых биндингов suffix может быть ''
    // → id="animation-{cellId}"). Защита от undefined проверена выше.
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
