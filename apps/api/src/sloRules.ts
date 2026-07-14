export type SloState = 'meeting' | 'breached' | 'no_data';

export function percentile(values: number[], percentileValue: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1));
  return sorted[index];
}

export function evaluateRatioSlo(successful: number, total: number, target: number, minimumSamples: number) {
  const ratio = total > 0 ? successful / total : null;
  const allowedErrorRatio = 1 - target;
  const observedErrorRatio = ratio === null ? null : 1 - ratio;
  const burnRate = observedErrorRatio === null
    ? null
    : allowedErrorRatio <= 0
      ? observedErrorRatio === 0 ? 0 : Number.POSITIVE_INFINITY
      : observedErrorRatio / allowedErrorRatio;
  const state: SloState = total < minimumSamples || ratio === null
    ? 'no_data'
    : ratio >= target ? 'meeting' : 'breached';

  return {
    state,
    target,
    successful,
    failed: Math.max(0, total - successful),
    total,
    ratio,
    errorBudget: {
      allowedErrorRatio,
      observedErrorRatio,
      burnRate,
      remainingFraction: observedErrorRatio === null || allowedErrorRatio <= 0
        ? null
        : Math.max(-1, Math.min(1, (allowedErrorRatio - observedErrorRatio) / allowedErrorRatio))
    }
  };
}

export function evaluateLatencySlo(samples: number[], targetSeconds: number, minimumSamples: number) {
  const p95Seconds = percentile(samples, 0.95);
  const state: SloState = samples.length < minimumSamples || p95Seconds === null
    ? 'no_data'
    : p95Seconds <= targetSeconds ? 'meeting' : 'breached';
  return {
    state,
    targetSeconds,
    samples: samples.length,
    p95Seconds,
    headroomSeconds: p95Seconds === null ? null : targetSeconds - p95Seconds
  };
}
