// Запуск десктоп-оболочки. Отдельный лаунчер нужен из-за ELECTRON_RUN_AS_NODE:
// её выставляет VS Code, и она протекает в интегрированный терминал — Electron
// тогда стартует как обычный Node, `require('electron')` отдаёт путь к бинарнику
// вместо API, и main падает на первом же вызове. Снимаем её явно.
import { spawn } from 'node:child_process'
import electron from 'electron'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// `--main <file>` — запустить другую точку входа (генератор иконки), иначе `.`
// (десктоп-оболочка из package.json main).
const argv = process.argv.slice(2)
const mainIdx = argv.indexOf('--main')
const entry = mainIdx >= 0 ? argv[mainIdx + 1] : '.'
const rest = mainIdx >= 0 ? argv.filter((_, i) => i !== mainIdx && i !== mainIdx + 1) : argv

const child = spawn(electron, [entry, ...rest], { stdio: 'inherit', env })
child.on('close', (code) => process.exit(code ?? 0))
