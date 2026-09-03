/**
 * Site-wide date formatting (replaces moment.js).
 *
 * Uses the built-in Intl API — zero bundle cost, locale-correct, and works
 * identically in server components (Node ships full ICU) and the browser.
 * Policy: all dates render in Chinese long form (2022年11月21日); anything
 * that includes a clock time renders Beijing time (UTC+8) explicitly.
 */

const longDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });

const longDateTime = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "Asia/Shanghai",
});

function toDate(dateLike) {
  return dateLike instanceof Date ? dateLike : new Date(dateLike);
}

/** 2022年11月21日 */
export function formatDate(dateLike) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  return longDate.format(date);
}

/** 2022年11月21日 20:30（北京时间） */
export function formatDateTime(dateLike) {
  const date = toDate(dateLike);
  if (Number.isNaN(date.getTime())) return "";
  return `${longDateTime.format(date)}（北京时间）`;
}

/** Current year, e.g. for the footer copyright. */
export function currentYear() {
  return new Date().getFullYear();
}
