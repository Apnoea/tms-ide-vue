// Релиз портативной сборки. Версионирование — CalVer `YYYY.M.PATCH`: SemVer тут
// мерить нечем (пакет private, API никто не импортирует), а ломать совместимость
// можно только в формате .zip — у него будет свой отдельный номер.
//
// Запускается ДО коммита правок, на грязном дереве: версия обязана уехать ТЕМ ЖЕ
// коммитом, что код. Иначе Pages деплоится с коммита без неё, и веб-версия
// показывает старый номер, хотя код в ней тот же, что в exe.
//
// `--dry` — показать следующую версию и выйти, ничего не запуская.
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgPath = path.join(root, 'package.json')

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

function fail(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

/**
 * Следующая версия: тот же месяц → патч+1, новый месяц → `.0`.
 * Ведущих нулей нет намеренно — `2026.08.0` невалиден для semver, а его парсят
 * и npm, и electron-builder.
 * @param {string} current
 * @param {Date} now
 * @returns {string}
 */
function nextVersion(current, now) {
  const stamp = `${now.getFullYear()}.${now.getMonth() + 1}`
  // Точка в префиксе обязательна: без неё «2026.10.x» сошёл бы за январский.
  if (!current.startsWith(`${stamp}.`)) return `${stamp}.0`
  const patch = Number(current.slice(stamp.length + 1))
  return `${stamp}.${Number.isFinite(patch) ? patch + 1 : 0}`
}

const pkgRaw = readFileSync(pkgPath, 'utf8')
const version = nextVersion(JSON.parse(pkgRaw).version, new Date())
console.log(`\n${JSON.parse(pkgRaw).version} → ${version}\n`)

if (process.argv.includes('--dry')) process.exit(0)

// Тот же гейт, что в CI, иначе push уронит деплой. Формат ПРАВИМ, а не проверяем:
// релиз идёт по незакоммиченным правкам, и отказывать из-за неотформатированной
// строки бессмысленно — файлы всё равно уедут в коммит следом.
console.log('→ Формат / lint / тесты / knip\n')
run('npm run format')
run('npm run lint')
run('npm test')
run('npm run knip')

// Версию пишем ДО сборки — electron-builder берёт её из package.json (и в имя
// артефакта). Точечная замена, а не JSON.stringify: порядок ключей и
// форматирование файла остаются как есть.
writeFileSync(pkgPath, pkgRaw.replace(/"version": "[^"]*"/, `"version": "${version}"`), 'utf8')

console.log(`\n→ Сборка ${version}\n`)
try {
  run('npm run desktop:build')
} catch {
  // Версия не заслужена: возвращаем прежнюю, чтобы следующий запуск не съел
  // номер, под которым ничего не выпущено.
  writeFileSync(pkgPath, pkgRaw, 'utf8')
  fail('Сборка упала — версия возвращена на прежнюю.')
}

// Отдельного коммита версии НЕТ намеренно: он деплоил бы веб-версию с номером,
// которого нет в exe, и наоборот. Версия — часть обычного коммита правок.
console.log(`\n✓ ${version} — ../release-tms/tms-ide-${version}-win.exe`)
console.log('  Версия в package.json — закоммить ВМЕСТЕ с правками дня.\n')
