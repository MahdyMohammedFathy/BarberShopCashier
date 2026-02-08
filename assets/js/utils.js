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

export function startOfTodayIso() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

export function sumTotals(list) {
  return list.reduce((total, item) => total + (Number(item.total) || 0), 0);
}
