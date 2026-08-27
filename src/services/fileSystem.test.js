// Выбор файла обязан работать БЕЗ File System Access API: Brave отключает его по
// умолчанию, в Firefox и Safari пользовательских пикеров нет — без фолбэка там не
// открыть ни проект, ни tag-list (кнопки отвечали ошибкой).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { pickFile } from './fileSystem'

/** Ловит созданный скрытый `<input type="file">` и подсовывает ему файлы. */
function interceptInput(action) {
  const orig = HTMLInputElement.prototype.click
  HTMLInputElement.prototype.click = function () {
    Object.defineProperty(this, 'files', { value: action.files, configurable: true })
    // Пикер асинхронный: даём pickFile навесить слушателей.
    setTimeout(() => this.dispatchEvent(new Event(action.event)), 0)
  }
  return () => {
    HTMLInputElement.prototype.click = orig
  }
}

afterEach(() => {
  delete window.showOpenFilePicker
})

describe('pickFile — фолбэк без FSA', () => {
  it('файл выбран → отдаёт File без handle', async () => {
    const file = new File(['A=Bool'], 'tags.csv')
    const restore = interceptInput({ files: [file], event: 'change' })
    const picked = await pickFile({ extensions: ['.csv'] })
    restore()
    expect(picked).toEqual({ file, handle: null })
  })

  it('диалог отменён → null (промис не висит: под projectBusy панель осталась бы inert)', async () => {
    const restore = interceptInput({ files: [], event: 'cancel' })
    const picked = await pickFile()
    restore()
    expect(picked).toBeNull()
  })

  it('фильтр расширений уезжает в accept инпута', async () => {
    const file = new File([''], 'p.zip')
    let seen = null
    const orig = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      seen = this.accept
      Object.defineProperty(this, 'files', { value: [file], configurable: true })
      setTimeout(() => this.dispatchEvent(new Event('change')), 0)
    }
    await pickFile({ extensions: ['.zip'], mime: 'application/zip' })
    HTMLInputElement.prototype.click = orig
    expect(seen).toBe('.zip')
  })

  it('клик по инпуту не дали → null, а не висячий промис (иначе projectBusy залипнет)', async () => {
    const orig = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      throw new Error('user activation required')
    }
    const picked = await pickFile()
    HTMLInputElement.prototype.click = orig
    expect(picked).toBeNull()
  })

  it('фокус вернулся, `cancel`/`change` не пришли → решаем по files инпута', async () => {
    vi.useFakeTimers()
    const file = new File([''], 'late.csv')
    // Браузер без события `cancel`: заполнил files, но `change` до нас не дошёл.
    const orig = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      Object.defineProperty(this, 'files', { value: [file], configurable: true })
      window.dispatchEvent(new Event('focus'))
    }
    const promise = pickFile()
    await vi.advanceTimersByTimeAsync(1000)
    HTMLInputElement.prototype.click = orig
    vi.useRealTimers()
    expect(await promise).toEqual({ file, handle: null })
  })

  it('фокус вернулся, инпут пуст → отмена (промис не остаётся висеть)', async () => {
    vi.useFakeTimers()
    const orig = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      window.dispatchEvent(new Event('focus'))
    }
    const promise = pickFile()
    await vi.advanceTimersByTimeAsync(1000)
    HTMLInputElement.prototype.click = orig
    vi.useRealTimers()
    expect(await promise).toBeNull()
  })

  it('инпут убирается из DOM после выбора', async () => {
    const restore = interceptInput({ files: [new File([''], 'a.csv')], event: 'change' })
    await pickFile()
    restore()
    expect(document.querySelector('input[type="file"]')).toBeNull()
  })
})

describe('pickFile — путь FSA', () => {
  it('отдаёт файл вместе с handle (по нему tag-list освежается на старте)', async () => {
    const file = new File(['A=Bool'], 'tags.csv')
    const handle = { getFile: vi.fn(async () => file) }
    window.showOpenFilePicker = vi.fn(async () => [handle])

    const picked = await pickFile({ extensions: ['.csv'], mime: 'text/csv', description: 'CSV' })

    expect(picked).toEqual({ file, handle })
    expect(window.showOpenFilePicker).toHaveBeenCalledWith({
      multiple: false,
      types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
    })
  })

  it('startIn прокидывается, отмена диалога → null', async () => {
    const startInHandle = { name: 'prev' }
    const err = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    window.showOpenFilePicker = vi.fn(async () => {
      throw err
    })
    expect(await pickFile({ startInHandle })).toBeNull()
    expect(window.showOpenFilePicker).toHaveBeenCalledWith({
      multiple: false,
      startIn: startInHandle,
    })
  })

  it('API есть, но вызвать не дали → уходим в фолбэк, а не в ошибку', async () => {
    // Браузеры блокируют FSA по-разному: где-то функции нет, где-то она бросает.
    // В обоих случаях файл должен открыться через input.
    window.showOpenFilePicker = vi.fn(async () => {
      throw Object.assign(new Error('blocked by policy'), { name: 'SecurityError' })
    })
    const file = new File([''], 'p.zip')
    const restore = interceptInput({ files: [file], event: 'change' })

    const picked = await pickFile({ extensions: ['.zip'] })

    restore()
    expect(picked).toEqual({ file, handle: null })
  })
})
