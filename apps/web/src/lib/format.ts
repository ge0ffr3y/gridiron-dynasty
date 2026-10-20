/** 6'4" */
export function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

/** "Feb 9, 2026" from a league date, without asking the real clock. */
export function formatLeagueDate(date: string): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${months[m - 1]} ${d}, ${y}`;
}

export function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
