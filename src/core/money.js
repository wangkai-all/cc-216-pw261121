// 金额一律以整数“分”在引擎内部流转，避免浮点误差；展示层再转元。

export function toCents(yuan) {
  if (yuan === null || yuan === undefined || yuan === '') return 0;
  const n = Number(yuan);
  if (!Number.isFinite(n)) throw new Error(`非法金额: ${yuan}`);
  return Math.round(n * 100);
}

export function toYuan(cents) {
  return (cents / 100).toFixed(2);
}

export function fmtYuan(cents) {
  const sign = cents < 0 ? '-' : '';
  return `${sign}¥${Math.abs(cents / 100).toFixed(2)}`;
}

export function clampCents(cents) {
  return Math.max(0, cents);
}
