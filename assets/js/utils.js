export const currency = new Intl.NumberFormat("ar-EG", {
  style: "currency",
  currency: "EGP",
  maximumFractionDigits: 2,
  numberingSystem: "latn",
});

export function formatMoney(value) {
  const safe = Number.isFinite(value) ? value : 0;
  return currency.format(safe);
}

export function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  return date.toLocaleString("ar-EG", {
    numberingSystem: "latn",
    timeZone: "Africa/Cairo",
  });
}

function getTimeZoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

function makeCairoDate(year, month, day, hour, minute, second) {
  const timeZone = "Africa/Cairo";
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offset * 60000);
}

function getCairoDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

function getCairoHour(date) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(hour);
}

export function businessDayRangeIso() {
  const now = new Date();
  const todayParts = getCairoDateParts(now);
  const hour = getCairoHour(now);

  const startBase = new Date(
    Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day)
  );
  if (hour < 12) {
    startBase.setUTCDate(startBase.getUTCDate() - 1);
  }
  const startParts = {
    year: startBase.getUTCFullYear(),
    month: startBase.getUTCMonth() + 1,
    day: startBase.getUTCDate(),
  };

  const start = makeCairoDate(
    startParts.year,
    startParts.month,
    startParts.day,
    12,
    0,
    0
  );

  const endBase = new Date(
    Date.UTC(startParts.year, startParts.month - 1, startParts.day)
  );
  endBase.setUTCDate(endBase.getUTCDate() + 1);
  const endParts = {
    year: endBase.getUTCFullYear(),
    month: endBase.getUTCMonth() + 1,
    day: endBase.getUTCDate(),
  };
  const end = makeCairoDate(endParts.year, endParts.month, endParts.day, 6, 0, 0);

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function sumTotals(list) {
  return list.reduce((total, item) => total + (Number(item.total) || 0), 0);
}
