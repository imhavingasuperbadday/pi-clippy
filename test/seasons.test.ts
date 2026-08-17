/** Unit test for the seasonal/holiday calendar (src/seasons.ts).
 *
 * The point of this suite is that the calendar is verifiable in August: the
 * computed holidays (Easter, Thanksgiving, the Monday/Sunday holidays) are
 * checked against known real dates, so a festive feature that can only be
 * observed in December is still testable today.
 */
import {
  detectOccasion,
  easterSunday,
  holidayOn,
  HOLIDAYS,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
  seasonalBriefing,
  seasonalDirective,
  seasonalOffer,
  seasonalStatement,
  seasonOf,
} from '../src/seasons.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

/** Local-time date, matching how the module reads the clock. */
function d(year: number, month1: number, day: number): Date {
  return new Date(year, month1 - 1, day, 12, 0, 0)
}

function idOn(year: number, month1: number, day: number): string | undefined {
  return holidayOn(d(year, month1, day))?.id
}

// --- calendar helpers ------------------------------------------------------

// 2026: January 1 is a Thursday.
check('nth weekday finds the 2nd Sunday of May 2026',
  nthWeekdayOfMonth(2026, 4, 0, 2) === 10, String(nthWeekdayOfMonth(2026, 4, 0, 2)))
check('nth weekday finds the 4th Thursday of November 2026',
  nthWeekdayOfMonth(2026, 10, 4, 4) === 26, String(nthWeekdayOfMonth(2026, 10, 4, 4)))
check('nth weekday reports a missing 5th occurrence',
  nthWeekdayOfMonth(2026, 1, 0, 5) === 0, String(nthWeekdayOfMonth(2026, 1, 0, 5)))
check('last weekday finds the last Monday of May 2026',
  lastWeekdayOfMonth(2026, 4, 1) === 25, String(lastWeekdayOfMonth(2026, 4, 1)))

// Easter Sunday, checked against the real Gregorian calendar.
const easters: Array<[number, number, number]> = [
  [2024, 3, 31],
  [2025, 4, 20],
  [2026, 4, 5],
  [2027, 3, 28],
  [2030, 4, 21],
]
for (const [year, month, day] of easters) {
  const actual = easterSunday(year)
  check(`Easter ${year} is ${month}/${day}`,
    actual.getMonth() === month - 1 && actual.getDate() === day,
    `${actual.getMonth() + 1}/${actual.getDate()}`)
}

// --- seasons ---------------------------------------------------------------

check('January is winter in the north', seasonOf(d(2026, 1, 15)) === 'winter')
check('April is spring in the north', seasonOf(d(2026, 4, 15)) === 'spring')
check('July is summer in the north', seasonOf(d(2026, 7, 15)) === 'summer')
check('October is autumn in the north', seasonOf(d(2026, 10, 15)) === 'autumn')
check('January is summer in the south', seasonOf(d(2026, 1, 15), 'south') === 'summer')
check('July is winter in the south', seasonOf(d(2026, 7, 15), 'south') === 'winter')
check('April is autumn in the south', seasonOf(d(2026, 4, 15), 'south') === 'autumn')
check('October is spring in the south', seasonOf(d(2026, 10, 15), 'south') === 'spring')

// --- fixed-date holidays ---------------------------------------------------

check('New Year is detected', idOn(2026, 1, 1) === 'new-year', String(idOn(2026, 1, 1)))
check("Clippy's birthday is 16 January", idOn(2026, 1, 16) === 'clippy-birthday', String(idOn(2026, 1, 16)))
check("Valentine's Day is detected", idOn(2026, 2, 14) === 'valentines', String(idOn(2026, 2, 14)))
check("St Patrick's Day is detected", idOn(2026, 3, 17) === 'st-patricks', String(idOn(2026, 3, 17)))
check("April Fools' is detected", idOn(2026, 4, 1) === 'april-fools', String(idOn(2026, 4, 1)))
check('Independence Day is detected', idOn(2026, 7, 4) === 'independence-day', String(idOn(2026, 7, 4)))
check('Halloween is detected', idOn(2026, 10, 31) === 'halloween', String(idOn(2026, 10, 31)))
check('Christmas is detected', idOn(2026, 12, 25) === 'christmas', String(idOn(2026, 12, 25)))
check("New Year's Eve is detected", idOn(2026, 12, 31) === 'new-year-eve', String(idOn(2026, 12, 31)))

// Windows, not single days.
check('Christmas covers the days around it', idOn(2026, 12, 22) === 'christmas', String(idOn(2026, 12, 22)))
check('Christmas ends on Boxing Day', idOn(2026, 12, 27) === undefined, String(idOn(2026, 12, 27)))
check('Halloween starts a few days early', idOn(2026, 10, 29) === 'halloween', String(idOn(2026, 10, 29)))

// --- computed holidays -----------------------------------------------------

// Easter Sunday 2026 is 5 April; the window runs Good Friday to Easter Monday.
check('Good Friday 2026 is the Easter window', idOn(2026, 4, 3) === 'easter', String(idOn(2026, 4, 3)))
check('Easter Sunday 2026 is detected', idOn(2026, 4, 5) === 'easter', String(idOn(2026, 4, 5)))
check('Easter Monday 2026 is detected', idOn(2026, 4, 6) === 'easter', String(idOn(2026, 4, 6)))
check('the Tuesday after Easter is not', idOn(2026, 4, 7) === undefined, String(idOn(2026, 4, 7)))

check('Thanksgiving 2026 is 26 November', idOn(2026, 11, 26) === 'thanksgiving', String(idOn(2026, 11, 26)))
check('the Friday after Thanksgiving counts', idOn(2026, 11, 27) === 'thanksgiving', String(idOn(2026, 11, 27)))
check('mid-November is not Thanksgiving', idOn(2026, 11, 12) === undefined, String(idOn(2026, 11, 12)))

check("Mother's Day 2026 is 10 May", idOn(2026, 5, 10) === 'mothers-day', String(idOn(2026, 5, 10)))
check('Memorial Day 2026 is 25 May', idOn(2026, 5, 25) === 'memorial-day', String(idOn(2026, 5, 25)))
check("Father's Day 2026 is 21 June", idOn(2026, 6, 21) === 'fathers-day', String(idOn(2026, 6, 21)))
check('Labor Day 2026 is 7 September', idOn(2026, 9, 7) === 'labor-day', String(idOn(2026, 9, 7)))

// Leap day exists only in leap years.
check('the leap day is detected', idOn(2028, 2, 29) === 'leap-day', String(idOn(2028, 2, 29)))

// Friday the 13th: a recurring pattern, not a fixed date.
check('Friday the 13th is detected', idOn(2026, 2, 13) === 'friday-13th', String(idOn(2026, 2, 13)))
check('a Tuesday the 13th is not', idOn(2026, 1, 13) === undefined, String(idOn(2026, 1, 13)))

// A named holiday outranks an incidental one when both could match.
check('an ordinary working day has no holiday', idOn(2026, 8, 17) === undefined, String(idOn(2026, 8, 17)))

// --- occasions -------------------------------------------------------------

const christmas = detectOccasion(d(2026, 12, 25))
check('a holiday occasion carries the holiday', christmas.holiday?.id === 'christmas')
check('a holiday occasion is still in a season', christmas.season === 'winter')
check('a holiday occasion offers holiday help',
  christmas.offers.includes('addressing your holiday cards'), christmas.offers.join(' | '))
check('the holiday statement follows "It looks like"',
  seasonalStatement(christmas).startsWith('you are'), seasonalStatement(christmas))

const plain = detectOccasion(d(2026, 8, 17))
check('an ordinary day has no holiday', plain.holiday === undefined)
check('an ordinary day still offers seasonal help', plain.offers.length > 0)
check('the seasonal statement follows "It looks like"',
  seasonalStatement(plain).startsWith('you are'), seasonalStatement(plain))

check('offers are drawn within range',
  plain.offers.includes(seasonalOffer(plain, 0)) && plain.offers.includes(seasonalOffer(plain, 0.999)))

check('the directive names the season', seasonalDirective(plain).includes('summer'), seasonalDirective(plain))
check('the directive names the holiday', seasonalDirective(christmas).includes('Christmas'))
check('the briefing is holiday-only',
  seasonalBriefing(plain) === undefined && (seasonalBriefing(christmas) ?? '').includes('Christmas'))

// Every holiday is well-formed: usable offers and a statement that can
// actually follow "It looks like ".
check('every holiday has usable offers and a statement',
  HOLIDAYS.every(h => h.offers.length > 0 && h.name.length > 0
    && h.offers.every(offer => offer.length > 5)
    && /^you\b/u.test(h.statement)),
  String(HOLIDAYS.length))
check('holiday ids are unique', new Set(HOLIDAYS.map(h => h.id)).size === HOLIDAYS.length)

// Sweep a whole year: no crashes, and holidays land on a sane number of days.
let holidayDays = 0
for (let month = 1; month <= 12; month += 1) {
  for (let day = 1; day <= 28; day += 1) {
    if (holidayOn(d(2026, month, day)) !== undefined) holidayDays += 1
  }
}
check('a year has a plausible number of holiday days',
  holidayDays > 5 && holidayDays < 60, String(holidayDays))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
