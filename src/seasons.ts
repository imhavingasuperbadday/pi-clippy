/** Seasonal and holiday awareness: the calendar half of Clippy's sense of
 * the world, next to the session climate in src/mood.ts.
 *
 * `extensions/index.ts` has advertised "seasonal offers" since the port
 * landed, but nothing ever implemented them. This is that feature: Clippy
 * knows what time of year it is and what day it is, and his office help bends
 * to match — envelopes and holiday cards in late December, receipts in April,
 * a costume sign-up sheet at Halloween.
 *
 * Everything here is pure and date-injectable, so the whole calendar is
 * unit-tested (test/seasons.test.ts) instead of only being observable in
 * December. Dates are read in LOCAL time, matching src/stats.ts, because a
 * holiday is a fact about the user's wall clock, not about UTC.
 */

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'
export type Hemisphere = 'north' | 'south'

export interface Holiday {
  /** Stable id (config, tests, and the "already greeted" bookkeeping). */
  readonly id: string
  /** How Clippy names the day. */
  readonly name: string
  /** Office-flavored things Clippy offers to help with on this day. Each one
   * completes "Would you like help ...?" */
  readonly offers: readonly string[]
  /** A statement that can follow "It looks like " — Clippy's own read on
   * what the day means, through Office eyes. */
  readonly statement: string
}

export interface Occasion {
  readonly season: Season
  /** The holiday in effect, when one is. */
  readonly holiday: Holiday | undefined
  /** Offers that fit right now: the holiday's when there is one, otherwise
   * the season's. Always non-empty. */
  readonly offers: readonly string[]
}

// --- Calendar helpers ------------------------------------------------------

/** Day of the month for the `nth` given weekday (0 = Sunday) of a month.
 * `nth` is 1-based; returns 0 when that occurrence does not exist. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): number {
  const firstWeekday = new Date(year, month, 1).getDay()
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7
  return day > daysInMonth(year, month) ? 0 : day
}

/** Day of the month for the LAST given weekday of a month. */
export function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const total = daysInMonth(year, month)
  const lastWeekday = new Date(year, month, total).getDay()
  return total - ((lastWeekday - weekday + 7) % 7)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Easter Sunday (Gregorian) by the anonymous computus. Returns a local-time
 * Date at midnight — the anchor for the Good Friday to Easter Monday window. */
export function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

/** Whole days between two local dates, ignoring the time of day. */
function dayDelta(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

// --- Seasons ---------------------------------------------------------------

/** Meteorological seasons: whole months, which is what a paperclip would
 * use. Flipped for the southern hemisphere so Clippy is not cheerfully
 * offering snowflake letterhead in an Australian January. */
export function seasonOf(date: Date, hemisphere: Hemisphere = 'north'): Season {
  const month = date.getMonth()
  const northern: Season =
    month <= 1 || month === 11 ? 'winter'
    : month <= 4 ? 'spring'
    : month <= 7 ? 'summer'
    : 'autumn'
  if (hemisphere === 'north') return northern
  return northern === 'winter' ? 'summer'
    : northern === 'spring' ? 'autumn'
    : northern === 'summer' ? 'winter'
    : 'spring'
}

/** Office help that fits the time of year, when no holiday is in effect. */
const SEASON_OFFERS: Record<Season, readonly string[]> = {
  winter: [
    'drafting your end-of-year summary',
    'addressing some seasonal cards',
    'organizing the files you meant to organize all year',
    'printing a calendar for the new quarter',
  ],
  spring: [
    'giving your filing cabinet a spring clean',
    'starting a fresh folder for the new quarter',
    'writing a letter about the weather',
    'making a checklist for all the tidying',
  ],
  summer: [
    'preparing an out-of-office message',
    'making a holiday schedule spreadsheet',
    'drafting a postcard',
    'planning the office party agenda',
  ],
  autumn: [
    'making a back-to-work schedule',
    'organizing your notes into a proper binder',
    'building a quarterly report',
    'drafting a memo about the shorter days',
  ],
}

const SEASON_STATEMENTS: Record<Season, string> = {
  winter: 'you are working through the coldest part of the year',
  spring: 'you are doing your spring tidying in a document',
  summer: 'you are working indoors on a perfectly good summer day',
  autumn: 'you are settling in for the busy part of the year',
}

// --- Holidays --------------------------------------------------------------

/** A holiday plus the rule that decides whether today is it. Predicates
 * (rather than fixed month/day pairs) let a holiday cover a window, a
 * computed date, or a recurring pattern like Friday the 13th. */
interface HolidayRule extends Holiday {
  readonly matches: (date: Date) => boolean
}

/** True when `date` falls on the given month/day (month is 0-based). */
function on(date: Date, month: number, day: number): boolean {
  return date.getMonth() === month && date.getDate() === day
}

/** True when `date` falls within an inclusive day range of one month. */
function between(date: Date, month: number, first: number, last: number): boolean {
  return date.getMonth() === month && date.getDate() >= first && date.getDate() <= last
}

/** Ordered most-specific first: the first rule that matches wins, so a named
 * holiday always beats an incidental one like Friday the 13th. */
const HOLIDAY_RULES: readonly HolidayRule[] = [
  {
    id: 'new-year',
    name: 'the new year',
    statement: 'you are starting the new year with a fresh document',
    offers: ['drafting your resolutions', 'setting up a filing system for the new year', 'making a calendar for the year ahead'],
    matches: date => between(date, 0, 1, 2),
  },
  {
    id: 'clippy-birthday',
    name: "Clippy's birthday",
    statement: 'you have forgotten what day it is, which is all right, it is only my birthday',
    offers: ['organizing a small party', 'writing a card for someone who has waited a long time', 'making a birthday banner'],
    // Office 97 shipped on 16 January 1997, which is when the paperclip
    // entered the world. He does not expect you to remember. He mentions it.
    matches: date => on(date, 0, 16),
  },
  {
    id: 'valentines',
    name: "Valentine's Day",
    statement: 'you are writing something heartfelt, and it appears to be a letter',
    offers: ['writing a love letter', 'addressing a card', 'making a table of chocolates'],
    matches: date => on(date, 1, 14),
  },
  {
    id: 'leap-day',
    name: 'the leap day',
    statement: 'you have been given an extra day and you are spending it on this',
    offers: ['planning what to do with the extra day', 'making a calendar that accounts for this properly'],
    matches: date => on(date, 1, 29),
  },
  {
    id: 'pi-day',
    name: 'Pi Day',
    statement: 'you are calculating the circumference of your coffee mug',
    offers: ['setting this out in a table to three decimal places', 'drafting a memo about circles', 'organizing a pie chart, which is the correct chart today'],
    matches: date => on(date, 2, 14),
  },
  {
    id: 'st-patricks',
    name: "St. Patrick's Day",
    statement: 'you are hoping for a bit of luck with this document',
    offers: ['making a green newsletter', 'drafting a toast', 'printing some shamrock letterhead'],
    matches: date => on(date, 2, 17),
  },
  {
    id: 'april-fools',
    name: "April Fools' Day",
    statement: 'you are being tricked by something, and I do not think it is me',
    offers: ['drafting a very serious memo', 'making a list of who fooled whom', 'printing a completely genuine report'],
    matches: date => on(date, 3, 1),
  },
  {
    id: 'easter',
    name: 'the Easter weekend',
    statement: 'you are working through a long weekend',
    offers: ['making a list of hiding places', 'drafting a spring newsletter', 'organizing a family gathering agenda'],
    // Good Friday through Easter Monday.
    matches: date => {
      const delta = dayDelta(easterSunday(date.getFullYear()), date)
      return delta >= -2 && delta <= 1
    },
  },
  {
    id: 'tax-day',
    name: 'tax season',
    statement: 'you are avoiding your receipts by writing this instead',
    offers: ['organizing your receipts', 'building a spreadsheet of deductions', 'drafting a letter to the tax office'],
    matches: date => between(date, 3, 13, 15),
  },
  {
    id: 'mothers-day',
    name: "Mother's Day",
    statement: 'you are working when you could be writing a card',
    offers: ['writing a card for your mother', 'drafting a heartfelt letter', 'making a table reservation list'],
    matches: date => date.getDate() === nthWeekdayOfMonth(date.getFullYear(), 4, 0, 2) && date.getMonth() === 4,
  },
  {
    id: 'may-the-fourth',
    name: 'the fourth of May',
    statement: 'you are using the Force, which I believe is a kind of macro',
    offers: ['drafting a memo to the Empire', 'organizing a rebellion in a spreadsheet', 'printing some very serious letterhead'],
    matches: date => on(date, 4, 4),
  },
  {
    id: 'memorial-day',
    name: 'the long weekend',
    statement: 'you are working on a day set aside for not working',
    offers: ['planning a barbecue schedule', 'drafting an out-of-office message', 'making a guest list'],
    matches: date => date.getMonth() === 4 && date.getDate() === lastWeekdayOfMonth(date.getFullYear(), 4, 1),
  },
  {
    id: 'fathers-day',
    name: "Father's Day",
    statement: 'you are working when you could be writing a card',
    offers: ['writing a card for your father', 'drafting a heartfelt letter', 'making a list of terrible ties'],
    matches: date => date.getMonth() === 5 && date.getDate() === nthWeekdayOfMonth(date.getFullYear(), 5, 0, 3),
  },
  {
    id: 'independence-day',
    name: 'the fourth of July',
    statement: 'you are indoors while something loud is happening outside',
    offers: ['making a barbecue checklist', 'drafting a patriotic newsletter', 'organizing a schedule for the fireworks'],
    matches: date => on(date, 6, 4),
  },
  {
    id: 'labor-day',
    name: 'the long weekend',
    statement: 'you are labouring on the day named for not labouring',
    offers: ['drafting an out-of-office message', 'making a schedule for the last of the summer', 'organizing a picnic list'],
    matches: date => date.getMonth() === 8 && date.getDate() === nthWeekdayOfMonth(date.getFullYear(), 8, 1, 1),
  },
  {
    id: 'halloween',
    name: 'Halloween',
    statement: 'you are being haunted by something, and it is probably this document',
    offers: ['printing a costume sign-up sheet', 'making a spooky newsletter', 'organizing a list of who brings the sweets'],
    matches: date => between(date, 9, 29, 31),
  },
  {
    id: 'thanksgiving',
    name: 'Thanksgiving',
    statement: 'you are working on a day meant for eating',
    offers: ['making a seating chart', 'drafting a thank-you letter', 'organizing the recipe binder'],
    // Thanksgiving Thursday and the Friday after it.
    matches: date => {
      if (date.getMonth() !== 10) return false
      const thursday = nthWeekdayOfMonth(date.getFullYear(), 10, 4, 4)
      return date.getDate() === thursday || date.getDate() === thursday + 1
    },
  },
  {
    id: 'christmas',
    name: 'Christmas',
    statement: 'you are working through the holidays, which is very dedicated of you',
    offers: ['addressing your holiday cards', 'making a gift list spreadsheet', 'printing some festive letterhead', 'drafting a thank-you note'],
    matches: date => between(date, 11, 20, 26),
  },
  {
    id: 'new-year-eve',
    name: "New Year's Eve",
    statement: 'you are closing out the year with one more change',
    offers: ['drafting your year-end summary', 'making a list of resolutions', 'organizing a countdown schedule'],
    matches: date => between(date, 11, 30, 31),
  },
  {
    id: 'friday-13th',
    name: 'Friday the thirteenth',
    statement: 'you are having the sort of day where things go wrong on their own',
    offers: ['making a list of what went wrong', 'drafting a very cautious memo', 'printing a backup copy of everything'],
    matches: date => date.getDay() === 5 && date.getDate() === 13,
  },
]

/** Every holiday the calendar knows about, in priority order. */
export const HOLIDAYS: readonly Holiday[] = HOLIDAY_RULES.map(({ matches: _matches, ...holiday }) => holiday)

/** The holiday in effect on `date`, if any. */
export function holidayOn(date: Date): Holiday | undefined {
  const rule = HOLIDAY_RULES.find(candidate => candidate.matches(date))
  if (rule === undefined) return undefined
  const { matches: _matches, ...holiday } = rule
  return holiday
}

/** What time of year it is, and what Clippy should be offering because of
 * it. The single entry point for the rest of the extension. */
export function detectOccasion(date = new Date(), hemisphere: Hemisphere = 'north'): Occasion {
  const season = seasonOf(date, hemisphere)
  const holiday = holidayOn(date)
  return {
    season,
    holiday,
    offers: holiday?.offers ?? SEASON_OFFERS[season],
  }
}

/** One seasonal offer, drawn at random. Completes "Would you like help ...?" */
export function seasonalOffer(occasion: Occasion, roll = Math.random()): string {
  const offers = occasion.offers
  return offers[Math.floor(roll * offers.length)] ?? offers[0]!
}

/** A statement that can follow "It looks like " — the seasonal counterpart of
 * a stats greeting. */
export function seasonalStatement(occasion: Occasion): string {
  return occasion.holiday?.statement ?? SEASON_STATEMENTS[occasion.season]
}

/** The calendar, as an instruction Clippy's system prompt can act on. Sits
 * alongside the mood directive: one tells him how the session feels, this
 * one tells him what time of year it is. */
export function seasonalDirective(occasion: Occasion): string {
  const seasonal = `CALENDAR: it is ${occasion.season}.`
  if (occasion.holiday === undefined) {
    return `${seasonal} You may let the time of year colour your office help, but only when it fits naturally. Never force it.`
  }
  return `${seasonal} Today is ${occasion.holiday.name}. You are quietly, earnestly festive about it in an office-supplies way — a card, a list, a banner, a schedule. Mention it only if it fits the line naturally; never force it, and never say it twice.`
}

/** The calendar, for a rival assistant. Buddies get it too, so a holiday can
 * be something the whole desktop is aware of rather than a Clippy-only
 * affectation. */
export function seasonalBriefing(occasion: Occasion): string | undefined {
  return occasion.holiday === undefined
    ? undefined
    : `Today is ${occasion.holiday.name}. You may work that in, in your own voice, if it is funny.`
}

// --- The New Year countdown ------------------------------------------------

/** How many seconds he counts down from. Thirty is long enough to be an
 * event and short enough to fit in one balloon. */
export const COUNTDOWN_SECONDS = 30

/** Milliseconds until the countdown should begin (23:59:30 on 31 December,
 * local time), or undefined when that moment is not within `withinMs`.
 *
 * A session that is open at the turn of the year is rare, which is the
 * whole charm — but it also means nothing may arm a timer months ahead, so
 * the runtime asks this question periodically and only arms when the answer
 * is close. A moment that has already passed returns undefined. */
export function msUntilCountdown(now = new Date(), withinMs = 3_600_000): number | undefined {
  const target = new Date(now.getFullYear(), 11, 31, 23, 59, 60 - COUNTDOWN_SECONDS, 0)
  const delta = target.getTime() - now.getTime()
  if (delta < 0 || delta > withinMs) return undefined
  return delta
}

/** The single balloon that counts the year out. One line, not thirty: the
 * floor serializes balloons, so thirty of them would still be arriving in
 * February. */
export function countdownLine(year: number): string {
  const numbers = [30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1].join('... ')
  return `${numbers}... Happy new year. It looks like you are starting ${year + 1} exactly as you finished ${year}. Would you like help with that?`
}
