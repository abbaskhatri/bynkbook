function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function monthEndYmd(month: string) {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const day = days[Math.max(1, Math.min(12, monthNumber)) - 1] ?? 30;
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthToRange(month: string) {
  return { from: `${month}-01`, to: monthEndYmd(month) };
}

export function previousMonth(month: string) {
  let year = Number(month.slice(0, 4));
  let monthNumber = Number(month.slice(5, 7)) - 1;
  if (monthNumber === 0) {
    year -= 1;
    monthNumber = 12;
  }
  return `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
}

/** The current month is closable only on its final calendar day. */
export function latestCompletedMonth(todayYmd: string) {
  const currentMonth = todayYmd.slice(0, 7);
  return monthEndYmd(currentMonth) <= todayYmd ? currentMonth : previousMonth(currentMonth);
}
