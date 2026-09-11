// Перенос диапазонов с элементов в символы: правило «переносим, только если у всех
// ячеек символа набор одинаков» защищает библиотеку от чужих порогов, поэтому оно и
// проверяется в первую очередь.
import { describe, it, expect } from 'vitest'
import { migrateFormsRanges, planRangeMigration, planWireRangeCleanup } from './rangeMigration'

const ROWS = [
  { min: 0, max: 5, color: '#10b981' },
  { min: 5, max: 10, color: '#ef4444' },
]

const cell = (id, stencilId, rangeSource, extra = {}) => ({
  id,
  tms: { stencilId, ...(rangeSource ? { rangeSource } : {}), ...extra },
})

const form = (id, cells) => ({ id, graphJson: { cells } })
const registry = (map) => (id) => map[id]

describe('planRangeMigration', () => {
  it('одинаковые наборы уезжают в символ, тег — в слот `range`', () => {
    const forms = [
      form('f1', [cell('c1', 'cell_qw', { tag: 'A.VAL', ranges: ROWS })]),
      form('f2', [cell('c2', 'cell_qw', { tag: 'B.VAL', ranges: ROWS })]),
    ]
    const plan = planRangeMigration(forms, registry({ cell_qw: { id: 'cell_qw' } }))

    expect(plan.stencils).toEqual([{ id: 'cell_qw', ranges: ROWS }])
    expect(plan.moved).toBe(2)
    // Тег у каждой ячейки свой — он и остаётся на ней, в слоте.
    const [f1, f2] = plan.forms
    expect(f1.graphJson.cells[0].tms.slots).toEqual({ range: 'A.VAL' })
    expect(f2.graphJson.cells[0].tms.slots).toEqual({ range: 'B.VAL' })
    expect(f1.graphJson.cells[0].tms.rangeSource).toBeUndefined()
  })

  it('расхождение наборов символ не трогает', () => {
    const other = [{ min: 0, max: 100, color: '#10b981' }]
    const forms = [
      form('f1', [
        cell('c1', 'cell_qw', { tag: 'A', ranges: ROWS }),
        cell('c2', 'cell_qw', { tag: 'B', ranges: other }),
      ]),
    ]
    const plan = planRangeMigration(forms, registry({ cell_qw: { id: 'cell_qw' } }))

    expect(plan.stencils).toEqual([])
    expect(plan.forms).toEqual([])
    expect(plan.moved).toBe(0)
    expect(plan.skipped[0]).toMatchObject({ stencilId: 'cell_qw' })
  })

  it('не трогает залоченный символ, символ с зонами и незнакомый', () => {
    const forms = [
      form('f1', [
        cell('c1', 'cell_node', { tag: 'A', ranges: ROWS }),
        cell('c2', 'cell_zoned', { tag: 'B', ranges: ROWS }),
        cell('c3', 'cell_ghost', { tag: 'C', ranges: ROWS }),
      ]),
    ]
    const plan = planRangeMigration(
      forms,
      registry({
        cell_node: { id: 'cell_node', locked: true },
        cell_zoned: { id: 'cell_zoned', ranges: ROWS },
      })
    )

    expect(plan.stencils).toEqual([])
    expect(plan.moved).toBe(0)
    expect(plan.skipped.map((s) => s.stencilId).sort()).toEqual([
      'cell_ghost',
      'cell_node',
      'cell_zoned',
    ])
  })

  it('шина залочена, но зоны в определение забирает — как любой символ', () => {
    const forms = [
      form('f1', [
        cell('b1', 'cell_bus', { tag: 'A.U', ranges: ROWS }),
        cell('b2', 'cell_bus', { tag: 'B.U', ranges: ROWS }),
      ]),
    ]
    const plan = planRangeMigration(forms, registry({ cell_bus: { id: 'cell_bus', locked: true } }))
    expect(plan.stencils).toEqual([{ id: 'cell_bus', ranges: ROWS }])
    expect(plan.moved).toBe(2)
    expect(plan.forms[0].graphJson.cells[1].tms.slots).toEqual({ range: 'B.U' })
  })

  it('строки без цвета или без порогов не переносятся', () => {
    // В экспорт они и так не попадают — незачем тащить их в определение символа.
    const forms = [form('f1', [cell('c1', 'cell_qw', { tag: 'A', ranges: [{ color: '' }, {}] })])]
    const plan = planRangeMigration(forms, registry({ cell_qw: { id: 'cell_qw' } }))
    expect(plan.stencils).toEqual([])
    expect(plan.moved).toBe(0)
  })

  it('прочие ячейки и формы возвращаются нетронутыми', () => {
    const keep = cell('c2', 'cell_qf')
    const forms = [
      form('f1', [cell('c1', 'cell_qw', { tag: 'A', ranges: ROWS }), keep]),
      form('f2', [cell('c3', 'cell_qf')]),
    ]
    const plan = planRangeMigration(
      forms,
      registry({ cell_qw: { id: 'cell_qw' }, cell_qf: { id: 'cell_qf' } })
    )

    // Форма без переносов в план не попадает — её незачем переписывать в IDB.
    expect(plan.forms.map((f) => f.id)).toEqual(['f1'])
    expect(plan.forms[0].graphJson.cells[1]).toBe(keep)
    // Вход не мутируется: исходная ячейка сохраняет свой источник.
    expect(forms[0].graphJson.cells[0].tms.rangeSource).toBeTruthy()
  })

  it('migrateFormsRanges переписывает только ячейки символов из набора', () => {
    // Символ, не принявший зоны (регистрация не удалась), в набор не входит — его
    // ячейки остаются со своим источником, иначе они потеряли бы цвет.
    const forms = [
      form('f1', [
        cell('c1', 'cell_qw', { tag: 'A', ranges: ROWS }),
        cell('c2', 'cell_qf', { tag: 'B', ranges: ROWS }),
      ]),
    ]
    const { forms: changed, moved } = migrateFormsRanges(forms, new Set(['cell_qw']))
    expect(moved).toBe(1)
    const [c1, c2] = changed[0].graphJson.cells
    expect(c1.tms).toEqual({ stencilId: 'cell_qw', slots: { range: 'A' } })
    expect(c2.tms.rangeSource).toEqual({ tag: 'B', ranges: ROWS })
  })

  it('planWireRangeCleanup снимает у провода настройку, равную унаследованной', () => {
    const wire = (id, source, target, tms = {}) => ({
      id,
      type: 'standard.Link',
      source: { id: source },
      target: { id: target },
      tms,
    })
    const BUS = { tag: 'BUS.U', ranges: ROWS }
    // Тот же набор, но записанный иначе (лишняя строка без цвета, другой порядок
    // полей) — сравнение идёт по канону строк.
    const same = { tag: 'BUS.U', ranges: [{ color: '' }, ...ROWS.map((r) => ({ ...r }))] }
    const forms = [
      form('f1', [
        cell('b', 'cell_bus', BUS),
        cell('q', 'cell_qw'),
        cell('n', 'cell_node', same),
        wire('w1', 'b', 'n', { rangeSource: same, strokeWidth: 4 }),
        wire('w2', 'n', 'q', { rangeSource: { tag: 'FEEDER.I', ranges: ROWS } }),
        wire('w3', 'q', 'q', { rangeSource: BUS }), // источника по цепи нет — остаётся
      ]),
    ]
    const plan = planWireRangeCleanup(forms, registry({ cell_bus: { id: 'cell_bus' } }))
    expect(plan.cleared).toBe(2)
    const cells = plan.forms[0].graphJson.cells
    expect(cells.find((c) => c.id === 'w1').tms).toEqual({ strokeWidth: 4 })
    expect(cells.find((c) => c.id === 'n').tms.rangeSource).toBeUndefined()
    // Свой тег (ток фидера) и провод без источника — нетронуты, вход не мутирован.
    expect(cells.find((c) => c.id === 'w2').tms.rangeSource.tag).toBe('FEEDER.I')
    expect(cells.find((c) => c.id === 'w3').tms.rangeSource).toBe(BUS)
    expect(forms[0].graphJson.cells.find((c) => c.id === 'w1').tms.rangeSource).toBe(same)
    // Форма без изменений в план не попадает.
    expect(planWireRangeCleanup([form('f2', [cell('q', 'cell_qw')])], () => null)).toEqual({
      forms: [],
      cleared: 0,
    })
  })

  it('мусор на входе не роняет план', () => {
    expect(planRangeMigration(null, () => null)).toEqual({
      stencils: [],
      forms: [],
      moved: 0,
      skipped: [],
    })
    expect(planRangeMigration([{ id: 'f', graphJson: null }], () => null).moved).toBe(0)
  })
})
