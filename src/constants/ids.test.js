import { describe, it, expect } from 'vitest'
import {
  outerKey,
  innerKey,
  innerPrefix,
  wireKey,
  valueTextKey,
  resolveSlotTemplate,
  hasSlotPlaceholder,
} from './ids'

describe('id generators', () => {
  it('outerKey: cell_value → animation-cell-{tag} (рантайм-конвенция)', () => {
    expect(outerKey('cell_value', 'PS031.UA')).toBe('animation-cell-PS031.UA')
  })

  it('outerKey: остальные → animation-{stencilId}-{animId}', () => {
    expect(outerKey('cell_qw', 'abc123')).toBe('animation-cell_qw-abc123')
    expect(outerKey('cell_qr', 'c1')).toBe('animation-cell_qr-c1')
  })

  it('innerKey: outer + suffix', () => {
    expect(innerKey('cell_qw', 'c1', '.QW')).toBe('animation-cell_qw-c1.QW')
    expect(innerKey('cell_qr', 'c1', '.closed')).toBe('animation-cell_qr-c1.closed')
    expect(innerKey('cell_qw', 'c1', '')).toBe('animation-cell_qw-c1')
    expect(innerKey('cell_qw', 'c1')).toBe('animation-cell_qw-c1')
  })

  it('innerPrefix: с трейлингом точкой для startsWith-проверок', () => {
    expect(innerPrefix('cell_qw', 'c1')).toBe('animation-cell_qw-c1.')
    expect(innerPrefix('cell_value', 'X')).toBe('animation-X.')
  })

  it('wireKey: animation-wire-{shortId}', () => {
    expect(wireKey('abc12345')).toBe('animation-wire-abc12345')
  })

  it('valueTextKey: animation-{tag} (без shortening)', () => {
    expect(valueTextKey('PS031.UA')).toBe('animation-PS031.UA')
    expect(valueTextKey('MY-TAG.IA')).toBe('animation-MY-TAG.IA')
  })
})

describe('resolveSlotTemplate', () => {
  it('подставляет одиночный {slot.X}', () => {
    expect(resolveSlotTemplate('{slot.onoff}', { onoff: 'PS031.ONOFF' })).toEqual({
      value: 'PS031.ONOFF',
      hadUnresolved: false,
    })
  })

  it('inline-подстановка (PRE{slot.x}POST) — общая семантика для parser и useSimulation', () => {
    expect(resolveSlotTemplate('PRE{slot.x}POST', { x: 'Y' })).toEqual({
      value: 'PREYPOST',
      hadUnresolved: false,
    })
  })

  it('несколько плейсхолдеров в одной строке', () => {
    expect(resolveSlotTemplate('{slot.a}.{slot.b}', { a: 'PS031', b: 'ONOFF' })).toEqual({
      value: 'PS031.ONOFF',
      hadUnresolved: false,
    })
  })

  it('пустое значение слота → hadUnresolved=true', () => {
    expect(resolveSlotTemplate('{slot.foo}', {})).toEqual({
      value: '',
      hadUnresolved: true,
    })
    expect(resolveSlotTemplate('{slot.foo}', { foo: '' })).toEqual({
      value: '',
      hadUnresolved: true,
    })
    expect(resolveSlotTemplate('{slot.foo}', { foo: null })).toEqual({
      value: '',
      hadUnresolved: true,
    })
  })

  it('частично-резолвнутый шаблон тоже flag-ает hadUnresolved', () => {
    const { value, hadUnresolved } = resolveSlotTemplate('{slot.a}/{slot.b}', { a: 'X' })
    expect(hadUnresolved).toBe(true)
    expect(value).toBe('X/')
  })

  it('строка без плейсхолдеров возвращается без изменений', () => {
    expect(resolveSlotTemplate('static-tag', {})).toEqual({
      value: 'static-tag',
      hadUnresolved: false,
    })
  })

  it('независимые вызовы не зависят от .lastIndex глобального regex', () => {
    // Регрессия: глобальный /g-regex со state'ом — если переиспользовать
    // один и тот же RegExp-instance, второй .replace вернёт битый результат.
    const slots = { x: 'V' }
    expect(resolveSlotTemplate('{slot.x}', slots).value).toBe('V')
    expect(resolveSlotTemplate('{slot.x}', slots).value).toBe('V')
    expect(resolveSlotTemplate('{slot.x}', slots).value).toBe('V')
  })
})

describe('hasSlotPlaceholder', () => {
  it('находит указанный slot-ключ', () => {
    expect(hasSlotPlaceholder('{slot.onoff}', 'onoff')).toBe(true)
    expect(hasSlotPlaceholder('PRE{slot.onoff}POST', 'onoff')).toBe(true)
  })

  it('не путает разные ключи', () => {
    expect(hasSlotPlaceholder('{slot.onoff}', 'alr')).toBe(false)
  })

  it('non-string → false', () => {
    expect(hasSlotPlaceholder(null, 'x')).toBe(false)
    expect(hasSlotPlaceholder(undefined, 'x')).toBe(false)
    expect(hasSlotPlaceholder(42, 'x')).toBe(false)
  })
})
