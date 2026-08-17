// Релиз портативной сборки. Версионирование — CalVer `YYYY.M.PATCH`: SemVer тут
// мерить нечем (пакет private, API никто не импортирует), а ломать совместимость
// можно только в формате .zip — у него будет свой отдельный номер.
//
// Версия — свойство АРТЕФАКТА, а не коммита: бампается только здесь, при сборке
// exe, поэтому каждое существующее число соответствует файлу, который реально
// кому-то отдали. Обычные коммиты её не трогают.
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

function capture(cmd) {
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim()
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

// Грязное дерево = непонятно, что окажется внутри exe, а тег будет врать про
// содержимое. Проверяем ПЕРВЫМ делом, до долгого гейта.
if (capture('git status --porcelain')) {
  fail(
    'Рабочее дерево не чисто — закоммить или спрячь правки перед релизом\n' +
      '  (частый случай: версия прошлого релиза так и осталась незакоммиченной).'
  )
}

// Тот же гейт, что в CI: релиз не должен обгонять зелёный билд, иначе тег уедет
// в историю, а деплой упадёт следом.
console.log('→ Проверки: format / lint / test / knip\n')
run('npm run format:check')
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
  fail('Сборка упала — версия возвращена на прежнюю, тег не поставлен.')
}

// Коммит и тег НЕ делаем сами — их прогоняет автор. Скрипт лишь оставляет
// изменённый package.json в дереве и подсказывает название.
console.log(`\n✓ ${version} — ../release-tms/tms-ide-${version}-win.exe`)
console.log('  package.json обновлён, не закоммичен\n')
console.log(`  Коммит: chore: release ${version}`)
console.log(`  Тег:    v${version}\n`)
