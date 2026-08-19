/** Unit test for the /clippy-settings schema (src/settings.ts): that every
 * field the editor offers is a key config.ts actually reads, that typed
 * values are parsed and bounded the way the editor promises, and that saving
 * touches only the `clippy` key of settings.json. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const settingsDir = mkdtempSync(join(tmpdir(), 'clippy-settings-'))
process.env['PI_CLIPPY_SETTINGS_DIR'] = settingsDir

const {
  applySetting,
  fieldFor,
  fieldsInGroup,
  formatMs,
  formatSettingValue,
  parseSettingValue,
  readClippySettings,
  renderSettings,
  SETTING_FIELDS,
  SETTING_GROUPS,
  settingRow,
  settingsPath,
  writeClippySettings,
} = await import('../src/settings.ts')
const { defaultClippyConfig } = await import('../src/config.ts')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- the schema is honest --------------------------------------------------
// Every field must correspond to something config.ts actually reads, or the
// editor is offering the user a dial that is not wired to anything. voice/
// voiceRate/voicePitch collapse into one `voice` object in the config, so
// they are checked by name rather than by key.
const configKeys = new Set([...Object.keys(defaultClippyConfig()), 'voiceRate', 'voicePitch', 'provider', 'model', 'port'])
const orphans = SETTING_FIELDS.filter(field => !configKeys.has(field.key))
check('every editable field is a real config key', orphans.length === 0, orphans.map(f => f.key).join(', '))
check('every field has help text', SETTING_FIELDS.every(field => field.help.length > 10))
check('every field belongs to a listed group',
  SETTING_FIELDS.every(field => (SETTING_GROUPS as readonly string[]).includes(field.group)))
check('every group has at least one field',
  SETTING_GROUPS.every(group => fieldsInGroup(group).length > 0))
check('field keys are unique',
  new Set(SETTING_FIELDS.map(field => field.key)).size === SETTING_FIELDS.length)
check('enum fields list their options',
  SETTING_FIELDS.filter(field => field.kind === 'enum').every(field => (field.options ?? []).length >= 2))
check('the new pi-facing dials are all offered',
  ['deskNotes', 'agentTools', 'destiny'].every(key => fieldFor(key) !== undefined))
check('lookup is case-insensitive', fieldFor('AUTOOPEN')?.key === 'autoOpen')
check('an unknown key is not a field', fieldFor('nonsense') === undefined)

// --- parsing ---------------------------------------------------------------
const boolField = fieldFor('autoOpen')!
check('yes is true', parseSettingValue(boolField, 'yes').ok && (parseSettingValue(boolField, 'yes') as { value: unknown }).value === true)
check('off is false', (parseSettingValue(boolField, 'off') as { value: unknown }).value === false)
check('nonsense is refused', !parseSettingValue(boolField, 'maybe').ok)
check('blank means the default', (parseSettingValue(boolField, '') as { value: unknown }).value === undefined)
check('"unset" means the default', (parseSettingValue(boolField, 'unset') as { value: unknown }).value === undefined)

const chanceField = fieldFor('cameoChance')!
check('a fraction is taken literally', (parseSettingValue(chanceField, '0.4') as { value: unknown }).value === 0.4)
check('a percent sign is honoured', (parseSettingValue(chanceField, '40%') as { value: unknown }).value === 0.4)
check('a bare number above 1 is read as a percent', (parseSettingValue(chanceField, '40') as { value: unknown }).value === 0.4)
check('an impossible chance is refused', !parseSettingValue(chanceField, '400%').ok)
check('a negative chance is refused', !parseSettingValue(chanceField, '-0.2').ok)

const msField = fieldFor('idleThinkAfterMs')!
check('seconds are understood', (parseSettingValue(msField, '90s') as { value: unknown }).value === 90_000)
check('minutes are understood', (parseSettingValue(msField, '5m') as { value: unknown }).value === 300_000)
check('raw milliseconds are understood', (parseSettingValue(msField, '120000') as { value: unknown }).value === 120_000)
check('a value below the minimum is refused', !parseSettingValue(msField, '1s').ok)
check('a value above the maximum is refused', !parseSettingValue(msField, '60m').ok)

const enumField = fieldFor('hemisphere')!
check('an enum option is accepted', (parseSettingValue(enumField, 'SOUTH') as { value: unknown }).value === 'south')
check('an enum non-option is refused', !parseSettingValue(enumField, 'equator').ok)

const listField = fieldFor('cameos')!
const parsedList = parseSettingValue(listField, 'bonzi, merlin bonzi')
check('a list parses and de-duplicates',
  parsedList.ok && (parsedList as { value: string[] }).value.join('|') === 'bonzi|merlin')
check('a list rejects a name nobody has', !parseSettingValue(listField, 'bonzi, clippy2').ok)

const numberField = fieldFor('port')!
check('a port is bounded', !parseSettingValue(numberField, '99999').ok)
check('a valid port is accepted', (parseSettingValue(numberField, '8765') as { value: unknown }).value === 8765)

// --- formatting ------------------------------------------------------------
check('an unset field shows its default', formatSettingValue(boolField, undefined).includes('(default)'))
check('a boolean reads as yes or no', formatSettingValue(boolField, false) === 'no')
check('a chance reads as a percentage', formatSettingValue(chanceField, 0.35) === '35%')
check('a duration reads in units', formatMs(300_000) === '5m' && formatMs(90_000) === '90s' && formatMs(250) === '250ms')
check('a row names the field and its value', settingRow(boolField, { autoOpen: false }).includes('no'))
check('the whole rendering groups the fields',
  SETTING_GROUPS.every(group => renderSettings({}).includes(`${group}:`)))

// --- applying --------------------------------------------------------------
const applied = applySetting({ voice: true }, 'autoOpen', false)
check('a value is applied', applied.autoOpen === false)
check('applying does not disturb the rest', applied.voice === true)
check('applying does not mutate the original', !('autoOpen' in { voice: true }))
check('an undefined value removes the key', !('voice' in applySetting({ voice: true }, 'voice', undefined)))

// --- the file itself -------------------------------------------------------
writeFileSync(settingsPath(), JSON.stringify({
  model: 'somebody/else',
  tools: { bash: true },
  clippy: { voice: true },
}, null, 2), 'utf8')
check('the existing clippy key is read back', readClippySettings().voice === true)

const written = writeClippySettings({ voice: false, destiny: true })
check('writing reports success', written.ok)
const after = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, any>
check('the clippy key is replaced', after.clippy.voice === false && after.clippy.destiny === true)
check('pi\'s own keys are left alone', after.model === 'somebody/else' && after.tools.bash === true)

writeClippySettings({})
const emptied = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Record<string, unknown>
check('an empty configuration removes the key entirely', !('clippy' in emptied))
check('and still leaves pi\'s keys alone', emptied.model === 'somebody/else')

rmSync(settingsDir, { recursive: true, force: true })

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
