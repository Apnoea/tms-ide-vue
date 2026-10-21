// @vitest-environment jsdom
// Форма проверки тегов: раскладка (группы, заголовки, столбцы) и сборка графа на
// настоящем символе «Проверка тега» из библиотеки — привязка слотов по типу тега.
import { describe, it, expect } from 'vitest'
import {
  layoutTagCheck,
  buildTagCheckGraph,
  tagCheckDescription,
  TAG_CHECK_STENCIL_ID,
} from './tagCheckForm'
import { getStencilById } from '../stencils/registry'
import { exportProject } from './exporter'
import { dia } from '@joint/core'
import { tmsNamespace } from '../stencils/tmsStencil'

const W = 240
const tag = (name, type = 'Float', path) => ({ name, type, ...(path ? { path } : {}) })
const at = (x, y) => ({ x, y })

it('описание формы: число тегов и дата сборки', () => {
  const text = tagCheckDescription(47, new Date(2026, 9, 21))
  expect(text).toContain('47 тегов')
  expect(text).toContain('21.10.2026')
})

describe('layoutTagCheck', () => {
  it('группы по алфавиту, заголовок у группы, у одиночного тега без пути — нет', () => {
    const tags = [
      tag('B.Z', 'Boolean'),
      tag('A.X', 'Boolean'),
      tag('A.Y'),
      tag('Tag1', 'Float', ['S17', 'N1']),
    ]
    const { rows, headers } = layoutTagCheck(tags, W)
    // A: заголовок + 2 тега; пустая строка; B.Z — одиночный, без заголовка; пустая
    // строка перед группой с путём (у неё заголовок есть, хоть тег и один).
    expect(headers).toEqual([
      { text: 'A', ...at(0, 0) },
      { text: 'S17 / N1', ...at(0, 120) },
    ])
    expect(rows.map((r) => [r.tag.name, r.x, r.y])).toEqual([
      ['A.X', 0, 20],
      ['A.Y', 0, 40],
      ['B.Z', 0, 80],
      ['Tag1', 0, 140],
    ])
  })

  it('длинная группа переходит в следующий столбец', () => {
    const tags = Array.from({ length: 45 }, (_, i) => tag(`G.T${i}`))
    const { rows } = layoutTagCheck(tags, W)
    // Строка 0 — заголовок, 1..39 — первые 39 тегов, дальше — второй столбец.
    expect(rows[38]).toMatchObject(at(0, 780))
    expect(rows[39]).toMatchObject(at(W + 40, 0))
  })

  it('заголовок не остаётся последней строкой столбца', () => {
    // A: заголовок + 37 тегов = строки 0..37; пустая — 38; заголовок B лёг бы на 39-ю
    // (последнюю) — уходит во второй столбец вместе с тегами.
    const tags = [...Array.from({ length: 37 }, (_, i) => tag(`A.T${i}`)), tag('B.X'), tag('B.Y')]
    const { headers, rows } = layoutTagCheck(tags, W)
    expect(headers[1]).toEqual({ text: 'B', ...at(W + 40, 0) })
    expect(rows.at(-2)).toMatchObject({ ...at(W + 40, 20) })
  })
})

describe('buildTagCheckGraph', () => {
  it('символ на каждый тег: значение — у любого, индикатор — у булевого, подпись — имя', () => {
    const stencil = getStencilById(TAG_CHECK_STENCIL_ID)
    expect(stencil).toBeTruthy()
    const json = buildTagCheckGraph([tag('A.ON', 'Boolean'), tag('A.U', 'Float')], stencil)

    const symbols = json.cells.filter((c) => c.tms?.stencilId === TAG_CHECK_STENCIL_ID)
    expect(symbols.map((c) => c.tms.slots)).toEqual([
      { value_text: 'A.ON', onoff: 'A.ON' },
      { value_text: 'A.U' },
    ])
    expect(symbols.map((c) => c.tms.params)).toEqual([{ p1: 'A.ON' }, { p1: 'A.U' }])
    expect(symbols[0].size).toEqual({ width: 240, height: 20 })

    const labels = json.cells.filter((c) => c.tms?.shape?.type === 'text')
    expect(labels.map((c) => c.tms.shape.text)).toEqual(['A'])
  })

  // Сквозь настоящий экспорт: форма уходит в рантайм тем же путём, что любая другая.
  it('экспорт: имя тега в view.svg, значение — text-карточкой, цвет — у булевого', () => {
    const stencil = getStencilById(TAG_CHECK_STENCIL_ID)
    const json = buildTagCheckGraph([tag('A.ON', 'Boolean'), tag('A.U', 'Float')], stencil)
    const graph = new dia.Graph({}, { cellNamespace: tmsNamespace })
    graph.fromJSON(json)
    const { svgText, animations } = exportProject(graph)

    expect(svgText).toContain('>A.ON</text>')
    const cards = Object.values(animations.animations)
    const valueTags = cards.filter((c) => c.animation === 'text').map((c) => c.bindings[0].tag)
    expect(valueTags.sort()).toEqual(['A.ON', 'A.U'])
    const colored = cards.flatMap((c) => c.bindings || []).filter((b) => b.when?.type === 'map')
    expect(colored.map((b) => b.tag)).toEqual(['A.ON'])
  })
})
