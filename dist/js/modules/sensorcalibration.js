(function (global) {
  'use strict';

  const namespace = global.EquiCoach || (global.EquiCoach = {});
  const analyzer = namespace.GaitAnalyzer;
  if (!analyzer) throw new Error('Das Ganganalyse-Modul wurde nicht geladen.');

  const storageKey = 'equi_sensor_calibration';
  const mounts = ['saddle', 'rider', 'other'];
  const gaits = ['walk', 'trot', 'canter'];
  const maxRhythmOverlapPercent = 10;
  const gaitLabels = { walk: 'Schritt', trot: 'Trab', canter: 'Galopp' };
  const captureDurationMs = 10000;
  const maxCapturesPerGait = 3;
  let activeCapture = null;

  function emptyCalibration() {
    return {
      version: 1,
      confirmedMounts: {},
      mounts: mounts.reduce((result, mount) => {
        result[mount] = gaits.reduce((byGait, gait) => {
          byGait[gait] = [];
          return byGait;
        }, {});
        return result;
      }, {})
    };
  }

  function readCalibration() {
    const saved = global.localStorage.getItem(storageKey);
    if (!saved) return emptyCalibration();

    const calibration = JSON.parse(saved);
    if (!calibration || calibration.version !== 1 || !calibration.mounts) {
      throw new Error('Die lokale Sensorkalibrierung ist ungültig. Lösche die Kalibrierung dieser Sensorposition und erfasse sie erneut.');
    }

    const normalized = emptyCalibration();
    normalized.confirmedMounts = mounts.reduce((result, mount) => {
      result[mount] = calibration.confirmedMounts?.[mount] === true;
      return result;
    }, {});
    mounts.forEach(mount => {
      gaits.forEach(gait => {
        const captures = calibration.mounts[mount]?.[gait];
        normalized.mounts[mount][gait] = Array.isArray(captures)
          ? captures.filter(capture =>
            capture &&
            Array.isArray(capture.samples) &&
            capture.analysis &&
            Number.isFinite(capture.completedAt)
          ).slice(-maxCapturesPerGait)
          : [];
      });
    });
    return normalized;
  }

  function writeCalibration(calibration) {
    global.localStorage.setItem(storageKey, JSON.stringify(calibration));
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function intervalOverlapPercent(first, second) {
    const firstMin = first.centerBpm - first.toleranceBpm;
    const firstMax = first.centerBpm + first.toleranceBpm;
    const secondMin = second.centerBpm - second.toleranceBpm;
    const secondMax = second.centerBpm + second.toleranceBpm;
    const intersection = Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin));
    const union = Math.max(firstMax, secondMax) - Math.min(firstMin, secondMin);
    return union > 0 ? intersection / union * 100 : 0;
  }

  function buildProfile(calibration, mount) {
    const profile = {};
    for (const gait of gaits) {
      const measurements = calibration.mounts[mount][gait]
        .map(capture => {
          const analyzed = analyzer.analyzeMotionSamples(capture.samples);
          const bpm = Number.isFinite(capture.analysis.bpm) && capture.analysis.bpm > 0
            ? capture.analysis.bpm
            : analyzed.bpm;
          const signalDeviation = Number.isFinite(capture.analysis.signalDeviation)
            ? capture.analysis.signalDeviation
            : analyzed.signalDeviation;
          const intervalVariationPercent = Number.isFinite(capture.analysis.intervalVariationPercent)
            ? capture.analysis.intervalVariationPercent
            : analyzed.intervalVariationPercent;
          return { bpm, signalDeviation, intervalVariationPercent };
        })
        .filter(measurement =>
          Number.isFinite(measurement.bpm) && measurement.bpm > 0 &&
          Number.isFinite(measurement.signalDeviation) && measurement.signalDeviation > 0 &&
          Number.isFinite(measurement.intervalVariationPercent)
        );
      if (measurements.length < 2) {
        return {
          ready: false,
          reason: `Für ${gait} werden mindestens zwei Messungen mit auswertbarem Rhythmus und Beschleunigungssignal benötigt.`
        };
      }

      const centerBpm = median(measurements.map(measurement => measurement.bpm));
      const medianDeviation = median(measurements.map(measurement => Math.abs(measurement.bpm - centerBpm)));
      const toleranceBpm = Math.max(8, medianDeviation * 3);
      const signalDeviation = median(measurements.map(measurement => measurement.signalDeviation));
      const intervalVariationPercent = median(measurements.map(measurement => measurement.intervalVariationPercent));
      if (
        !Number.isFinite(centerBpm) ||
        !Number.isFinite(toleranceBpm) ||
        !Number.isFinite(signalDeviation) ||
        !Number.isFinite(intervalVariationPercent)
      ) {
        return { ready: false, reason: `Die Messungen für ${gait} ergeben keinen stabilen Rhythmus.` };
      }
      profile[gait] = {
        centerBpm,
        toleranceBpm,
        signalDeviation,
        intervalVariationPercent
      };
    }

    for (let first = 0; first < gaits.length; first += 1) {
      for (let second = first + 1; second < gaits.length; second += 1) {
        const firstGait = gaits[first];
        const secondGait = gaits[second];
        const overlapPercent = intervalOverlapPercent(profile[firstGait], profile[secondGait]);
        if (overlapPercent > maxRhythmOverlapPercent + 1e-9) {
          return {
            ready: false,
            reason: `Die Rhythmusbereiche von ${gaitLabels[firstGait]} und ${gaitLabels[secondGait]} überschneiden sich zu ${overlapPercent.toFixed(1)}% (erlaubt: höchstens ${maxRhythmOverlapPercent}%).`
          };
        }
      }
    }

    return { ready: true, profile };
  }

  function getSummary(mount) {
    if (!mounts.includes(mount)) throw new Error('Unbekannte Sensorposition.');
    const calibration = readCalibration();
    const summary = gaits.reduce((result, gait) => {
      result[gait] = calibration.mounts[mount][gait].map(capture => ({
        completedAt: capture.completedAt,
        sampleCount: capture.samples.length,
        analysis: { ...capture.analysis }
      }));
      return result;
    }, {});
    const readiness = buildProfile(calibration, mount);
    return {
      ...summary,
      confirmed: calibration.confirmedMounts[mount] === true,
      ready: readiness.ready,
      reason: readiness.reason || null,
      profile: readiness.ready ? readiness.profile : null
    };
  }

  function persistCapture(mount, gait, samples, source) {
    const calibration = readCalibration();
    const captures = calibration.mounts[mount][gait];
    const analysis = analyzer.analyzeMotionSamples(samples);
    const capture = {
      completedAt: Date.now(),
      source,
      samples,
      analysis: {
        label: analysis.label,
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        peakCount: analysis.peakCount,
        intervalVariationPercent: analysis.intervalVariationPercent,
        signalMean: analysis.signalMean,
        signalDeviation: analysis.signalDeviation
      }
    };
    const replacedOldest = captures.length >= maxCapturesPerGait;
    captures.push(capture);
    calibration.mounts[mount][gait] = captures.slice(-maxCapturesPerGait);
    calibration.confirmedMounts[mount] = false;
    writeCalibration(calibration);
    return {
      capture: {
        completedAt: capture.completedAt,
        sampleCount: samples.length,
        analysis: { ...capture.analysis }
      },
      replacedOldest
    };
  }

  function attachDeviceMotion(onSample) {
    return new Promise((resolve, reject) => {
      const DeviceMotion = global.DeviceMotionEvent;
      if (!DeviceMotion) {
        reject(new Error('Kein kompatibler Bewegungssensor verfügbar.'));
        return;
      }

      const listen = () => {
        const handler = event => {
          const hasLinearAcceleration = event.acceleration &&
            Number.isFinite(event.acceleration.x) &&
            Number.isFinite(event.acceleration.y) &&
            Number.isFinite(event.acceleration.z);
          const includesGravity = !hasLinearAcceleration;
          const acceleration = hasLinearAcceleration
            ? event.acceleration
            : event.accelerationIncludingGravity;
          if (!acceleration) return;
          onSample({
            timestamp: event.timeStamp,
            x: acceleration.x,
            y: acceleration.y,
            z: acceleration.z,
            includesGravity,
            source: 'DeviceMotion'
          });
        };
        global.addEventListener('devicemotion', handler);
        resolve(() => global.removeEventListener('devicemotion', handler));
      };

      if (typeof DeviceMotion.requestPermission === 'function') {
        DeviceMotion.requestPermission().then(permission => {
          if (permission !== 'granted') {
            reject(new Error('Sensorzugriff wurde nicht erlaubt.'));
            return;
          }
          listen();
        }, reject);
        return;
      }

      listen();
    });
  }

  async function attachSensor(onSample, onError) {
    if ('Accelerometer' in global) {
      let sensor;
      let reading;
      let error;
      try {
        sensor = new global.Accelerometer({ frequency: 50 });
        reading = () => onSample({
          timestamp: sensor.timestamp,
          x: sensor.x,
          y: sensor.y,
          z: sensor.z,
          includesGravity: true,
          source: 'Accelerometer'
        });
        error = event => onError(event.error || new Error('Accelerometer wurde unterbrochen.'));
        sensor.addEventListener('reading', reading);
        sensor.addEventListener('error', error);
        sensor.start();
        return () => {
          sensor.removeEventListener('reading', reading);
          sensor.removeEventListener('error', error);
          sensor.stop();
        };
      } catch {
        if (sensor) {
          if (reading) sensor.removeEventListener('reading', reading);
          if (error) sensor.removeEventListener('error', error);
          try {
            sensor.stop();
          } catch (stopError) {
            console.warn('Accelerometer konnte nach dem Startfehler nicht beendet werden.', stopError);
          }
        }
      }
    }

    return attachDeviceMotion(onSample);
  }

  function capture(mount, gait, onProgress) {
    if (activeCapture) return Promise.reject(new Error('Eine Sensormessung läuft bereits.'));
    if (!global.isSecureContext) {
      return Promise.reject(new Error('Sensorkalibrierung erfordert HTTPS oder localhost.'));
    }
    if (!mounts.includes(mount) || !gaits.includes(gait)) {
      return Promise.reject(new Error('Sensorposition oder Gangart ist ungültig.'));
    }

    return new Promise((resolve, reject) => {
      const samples = [];
      let cleanupSensor = () => {};
      let progressTimer = null;
      let captureTimer = null;
      let startedAt = 0;
      let settled = false;
      let source = null;
      const captureState = { cleanup: null };

      const cleanup = () => {
        if (progressTimer !== null) global.clearInterval(progressTimer);
        if (captureTimer !== null) global.clearTimeout(captureTimer);
        try {
          cleanupSensor();
        } catch (error) {
          console.warn('Kalibrierungssensor konnte nicht sauber beendet werden.', error);
        } finally {
          if (activeCapture === captureState) activeCapture = null;
        }
      };
      const fail = error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (samples.length < 20) {
          reject(new Error(`Zu wenige Sensormesswerte (${samples.length}). Prüfe den Sensorzugriff und versuche es erneut.`));
          return;
        }

        try {
          resolve(persistCapture(mount, gait, samples, source));
        } catch (error) {
          reject(new Error(`Kalibrierungsdaten konnten nicht lokal gespeichert werden: ${error.message}`));
        }
      };
      const onSample = sample => {
        if (
          !Number.isFinite(sample.x) ||
          !Number.isFinite(sample.y) ||
          !Number.isFinite(sample.z)
        ) return;
        source = source || sample.source;
        samples.push({
          timestamp: Number.isFinite(sample.timestamp) ? sample.timestamp : global.performance.now(),
          x: sample.x,
          y: sample.y,
          z: sample.z,
          includesGravity: sample.includesGravity
        });
      };

      captureState.cleanup = () => fail(new DOMException('Messung abgebrochen.', 'AbortError'));
      activeCapture = captureState;
      attachSensor(onSample, fail).then(cleanup => {
        if (settled) {
          cleanup();
          return;
        }
        cleanupSensor = cleanup;
        startedAt = global.performance.now();
        if (typeof onProgress === 'function') onProgress(0);
        progressTimer = global.setInterval(() => {
          if (typeof onProgress === 'function') {
            onProgress(Math.min(100, (global.performance.now() - startedAt) / captureDurationMs * 100));
          }
        }, 200);
        captureTimer = global.setTimeout(finish, captureDurationMs);
      }, fail);
    });
  }

  function cancel() {
    if (activeCapture) activeCapture.cleanup();
  }

  function clearMount(mount) {
    if (!mounts.includes(mount)) throw new Error('Unbekannte Sensorposition.');
    const calibration = readCalibration();
    calibration.mounts[mount] = gaits.reduce((result, gait) => {
      result[gait] = [];
      return result;
    }, {});
    calibration.confirmedMounts[mount] = false;
    const hasCaptures = mounts.some(key =>
      gaits.some(gait => calibration.mounts[key][gait].length > 0)
    );
    if (hasCaptures) writeCalibration(calibration);
    else global.localStorage.removeItem(storageKey);
  }

  function confirm(mount) {
    if (!mounts.includes(mount)) throw new Error('Unbekannte Sensorposition.');
    const calibration = readCalibration();
    const readiness = buildProfile(calibration, mount);
    if (!readiness.ready) throw new Error(readiness.reason);
    calibration.confirmedMounts[mount] = true;
    writeCalibration(calibration);
    return readiness.profile;
  }

  function getConfirmedProfile(mount) {
    if (!mounts.includes(mount)) throw new Error('Unbekannte Sensorposition.');
    const calibration = readCalibration();
    if (calibration.confirmedMounts[mount] !== true) return null;
    const readiness = buildProfile(calibration, mount);
    if (!readiness.ready) return null;
    return readiness.profile;
  }

  namespace.SensorCalibration = {
    capture,
    cancel,
    clearMount,
    confirm,
    getConfirmedProfile,
    getSummary,
    captureDurationMs,
    maxCapturesPerGait
  };
})(window);
