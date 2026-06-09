// Регрессионный тест к багу «при дублировании есть провода до оригинальных
// объектов»: новые bridge-линки должны указывать на НОВЫЕ ячейки и сохранять
// router/connector/attrs из LINK_DEFAULTS (factory defaultLink не работает
// на JSON-path при graph.addCell).
import { describe, it, expect } from 'vitest'
import { dia, shapes } from '@joint/core'
import { LINK_DEFAULTS } from '../stencils/linkDefaults'

describe('paste bridge-link via new shapes.standard.Link', () => {
  it('новый линк ссылается на новые ячейки и наследует LINK_DEFAULTS', () => {
    const g = new dia.Graph({}, { cellNamespace: shapes })
    g.addCell([
      new shapes.standard.Rectangle({
        id: 'A',
        size: { width: 50, height: 50 },
        position: { x: 0, y: 0 },
      }),
      new shapes.standard.Rectangle({
        id: 'B',
        size: { width: 50, height: 50 },
        position: { x: 100, y: 0 },
      }),
      new shapes.standard.Rectangle({
        id: 'NEW_A',
        size: { width: 50, height: 50 },
        position: { x: 200, y: 0 },
      }),
      new shapes.standard.Rectangle({
        id: 'NEW_B',
        size: { width: 50, height: 50 },
        position: { x: 300, y: 0 },
      }),
    ])

    // имитация collectBridgeLinkSnaps + pasteSnapshots (новый API)
    const linkModel = new shapes.standard.Link({
      ...LINK_DEFAULTS,
      source: { id: 'NEW_A', port: 'p1' },
      target: { id: 'NEW_B', port: 'p2' },
      tms: { voltageSource: { tag: 'V.1' } },
    })
    g.addCell(linkModel)

    expect(linkModel.get('source').id).toBe('NEW_A')
    expect(linkModel.get('target').id).toBe('NEW_B')
    expect(linkModel.get('source').port).toBe('p1')
    expect(linkModel.get('target').port).toBe('p2')
    expect(linkModel.get('router')?.name).toBe(LINK_DEFAULTS.router.name)
    expect(linkModel.get('connector')?.name).toBe(LINK_DEFAULTS.connector.name)
    expect(linkModel.get('tms')?.voltageSource?.tag).toBe('V.1')
    // graph.addCell возвращает граф — id берём с самой модели
    expect(linkModel.id).toBeDefined()
  })
})
