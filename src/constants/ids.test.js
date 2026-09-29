import { describe, it, expect } from 'vitest'
import {
  outerKey,
  innerKey,
  innerPrefix,
  wireKey,
  resolveSlotTemplate,
  normalizeParams,
} from './ids'

describe('id generators', () => {
  it('outerKey: animation-{stencilId}-{animId} — одна схема на все символы', () => {
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
    expect(innerPrefix('cell_value', 'c1')).toBe('animation-cell_value-c1.')
  })

  it('wireKey: animation-wire-{shortId}', () => {
    expect(wireKey('abc12345')).toBe('animation-wire-abc12345')
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

describe('normalizeParams', () => {
  it('оставляет только годные ключи и одну строку, пустой набор → undefined', () => {
    expect(normalizeParams({ p1: '  Ia  ', unit: 'кА' })).toEqual({ p1: 'Ia', unit: 'кА' })
    // Ключ уезжает в data-tms-param и в tms.params, а приходит из чужого архива —
    // маска та же, что у объявлений символа.
    expect(normalizeParams({ 'p 1': 'x', P1: 'x', '1p': 'x' })).toBeUndefined()
    expect(normalizeParams({ p1: 5, p2: null })).toBeUndefined()
    // Перевод строки в подписи не отрисовался бы (подстановка в textContent).
    expect(normalizeParams({ p1: 'A\nB' })).toEqual({ p1: 'A B' })
    expect(normalizeParams({ p1: '   ' })).toBeUndefined()
    expect(normalizeParams(null)).toBeUndefined()
  })
})
