const globalScope = typeof window === 'undefined' ? globalThis : window;
globalScope.EquiCoach = globalScope.EquiCoach || {};
globalScope.EquiCoach.GaitAnalyzer = (function (global) {
'use strict';

const GRAVITY_MPS2 = 9.81;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function magnitudeFromAcceleration(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

function classifyGaitByBpm(bpm) {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return {
      label: "Unbekannt",
      confidence: 0,
      summary: "Zu wenige eindeutige Bewegungsimpulse",
    };
  }

  if (bpm < 80) {
    return {
      label: "Schritt",
      confidence: bpm < 70 ? 0.72 : 0.86,
      summary: "Langsamer, gleichmäßiger Schritt",
    };
  }

  if (bpm < 130) {
    return {
      label: "Trab",
      bpm,
      confidence: 0.9,
      summary: "Gleichmäßiger Trab-Rhythmus",
    };
  }

  if (bpm < 200) {
    return {
      label: "Galopp",
      bpm,
      confidence: 0.88,
      summary: "Schneller, rhythmischer Galopp",
    };
  }

  return {
    label: "Unbekannt",
    bpm,
    confidence: 0.4,
    summary: "Rhythmus außerhalb des normalen Musters",
  };
}

function classifyBpmByProfile(bpm, peakCount, profile) {
  if (!Number.isFinite(bpm) || bpm <= 0 || peakCount < 3 || !profile) return null;

  const candidates = Object.entries(profile)
    .filter(([gait, values]) =>
      ["walk", "trot", "canter"].includes(gait) &&
      Number.isFinite(values?.centerBpm) &&
      Number.isFinite(values?.toleranceBpm) &&
      values.toleranceBpm > 0
    )
    .map(([gait, values]) => ({
      gait,
      distance: Math.abs(bpm - values.centerBpm),
      tolerance: values.toleranceBpm
    }))
    .sort((a, b) => a.distance - b.distance);

  const closest = candidates[0];
  if (!closest || closest.distance > closest.tolerance) return null;

  const second = candidates[1];
  if (second && second.distance - closest.distance < 5) return null;

  return {
    gait: closest.gait,
    bpm,
    confidence: Math.max(0, 1 - closest.distance / closest.tolerance)
  };
}

function estimateBpmFromPeaks(peakTimes) {
  if (!peakTimes || peakTimes.length < 2) {
    return 0;
  }

  const intervals = [];

  for (let i = 1; i < peakTimes.length; i++) {
    const delta = peakTimes[i] - peakTimes[i - 1];
    if (delta > 250 && delta < 2000) {
      intervals.push(delta);
    }
  }

  if (!intervals.length) {
    return 0;
  }

  const avgInterval =
    intervals.reduce((sum, value) => sum + value, 0) / intervals.length;

  return Math.round(60000 / avgInterval);
}

function estimateIntervalVariationPercent(peakTimes) {
  if (!peakTimes || peakTimes.length < 3) return null;

  const intervals = [];
  for (let index = 1; index < peakTimes.length; index += 1) {
    const interval = peakTimes[index] - peakTimes[index - 1];
    if (interval > 250 && interval < 2000) intervals.push(interval);
  }
  if (intervals.length < 2) return null;

  const mean = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  const variance = intervals.reduce((sum, interval) => sum + (interval - mean) ** 2, 0) / intervals.length;
  return mean > 0 ? Number((Math.sqrt(variance) / mean * 100).toFixed(2)) : null;
}

function detectPeaks(samples, threshold = 8, minPeakGapMs = 220) {
  const peakTimes = [];
  let lastPeak = null;
  const smoothedValues = samples.map((sample, index) => {
    const previous = samples[index - 1]?.magnitude ?? sample.magnitude ?? 0;
    const current = sample.magnitude ?? 0;
    const next = samples[index + 1]?.magnitude ?? current;
    return (previous + current * 2 + next) / 4;
  });

  for (let i = 1; i < samples.length - 1; i++) {
    const sample = samples[i];
    const smoothed = smoothedValues[i];
    sample.smoothed = smoothed;

    const now = sample.timestamp;
    const isPeak =
      smoothed >= threshold &&
      (lastPeak === null || now - lastPeak > minPeakGapMs) &&
      smoothed > smoothedValues[i - 1] &&
      smoothed >= smoothedValues[i + 1];

    if (isPeak) {
      peakTimes.push(now);
      lastPeak = now;
    }
  }

  return peakTimes;
}

function normalizeMotionSamples(rawSamples) {
  return rawSamples
    .filter((sample) => sample &&
      Number.isFinite(sample.x) &&
      Number.isFinite(sample.y) &&
      Number.isFinite(sample.z) &&
      Number.isFinite(sample.timestamp))
    .map((sample) => {
      const { x, y, z } = sample;
      const magnitude = magnitudeFromAcceleration(x, y, z);

      return {
        timestamp: sample.timestamp,
        x,
        y,
        z,
        magnitude: sample.includesGravity
          ? Math.abs(magnitude - GRAVITY_MPS2)
          : magnitude,
        smoothed: 0,
        bpm: 0,
      };
    });
}

function analyzeMotionSamples(rawSamples, options = {}) {
  const samples = normalizeMotionSamples(Array.isArray(rawSamples) ? rawSamples : []);
  const mean = samples.length
    ? samples.reduce((sum, sample) => sum + sample.magnitude, 0) / samples.length
    : 0;
  const variance = samples.length
    ? samples.reduce((sum, sample) => sum + (sample.magnitude - mean) ** 2, 0) / samples.length
    : 0;
  const threshold = Number.isFinite(options.threshold)
    ? options.threshold
    : Math.max(0.15, mean + Math.sqrt(variance) * 0.35);
  const minPeakGapMs = Number.isFinite(options.minPeakGapMs)
    ? clamp(options.minPeakGapMs, 150, 2000)
    : 250;

  const peaks = detectPeaks(samples, threshold, minPeakGapMs);

  const bpm = estimateBpmFromPeaks(peaks);
  const intervalVariationPercent = estimateIntervalVariationPercent(peaks);

  const classification = classifyGaitByBpm(bpm);

  const processed = {
    ...classification,
    bpm,
    peakCount: peaks.length,
    intervalVariationPercent,
    signalMean: Number(mean.toFixed(4)),
    signalDeviation: Number(Math.sqrt(variance).toFixed(4)),
    samples: samples.map((sample) => ({
      timestamp: sample.timestamp,
      magnitude: Number(sample.magnitude.toFixed(4)),
      smoothed: Number(sample.smoothed.toFixed(4)),
      bpm: sample.bpm || bpm,
    })),
    peakTimes: peaks,
  };

  return processed;
}

function calculateSessionSummary(samples) {
  if (!samples || !samples.length) {
    return {
      avgBPM: 0,
      maxBPM: 0,
      minBPM: 0,
      durationSeconds: 0,
    };
  }

  const timestamps = samples.map((sample) => sample.timestamp).sort((a, b) => a - b);

  const start = timestamps[0];
  const end = timestamps[timestamps.length - 1];
  const durationSeconds = (end - start) / 1000;

  const bpmValues = samples
    .map((sample) => sample.bpm)
    .filter((value) => value && value > 0);

  const avgBPM =
    bpmValues.length > 0
      ? Math.round(
          bpmValues.reduce((sum, value) => sum + value, 0) / bpmValues.length
        )
      : 0;

  const maxBPM = bpmValues.length > 0 ? Math.max(...bpmValues) : 0;
  const minBPM = bpmValues.length > 0 ? Math.min(...bpmValues) : 0;

  return {
    avgBPM,
    maxBPM,
    minBPM,
    durationSeconds,
  };
}

return {
  magnitudeFromAcceleration,
  classifyGaitByBpm,
  classifyBpmByProfile,
  estimateBpmFromPeaks,
  estimateIntervalVariationPercent,
  detectPeaks,
  normalizeMotionSamples,
  analyzeMotionSamples,
  calculateSessionSummary,
};
})(globalScope);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalScope.EquiCoach.GaitAnalyzer;
}
