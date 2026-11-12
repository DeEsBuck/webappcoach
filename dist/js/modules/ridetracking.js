window.EquiCoach = window.EquiCoach || {};
window.EquiCoach.RideTracking = (() => {
  const gaitAnalyzer = window.EquiCoach.GaitAnalyzer;
  if (!gaitAnalyzer) throw new Error('Das Ganganalyse-Modul wurde nicht geladen.');

  const storageKey = 'equi_active_start';
  const gaits = ['walk', 'trot', 'canter', 'pause'];
  const sensorProfiles = {
    saddle: { label: 'Pferd / Sattel', threshold: 1.0 },
    rider: { label: 'Reiter', threshold: 1.5 },
    other: { label: 'Anderer Ort', threshold: 1.2 }
  };
  const gravity = 9.81;
  const minStepIntervalMs = 250;
  const maxRecentSamples = 600;
  const autoAnalysisIntervalMs = 2000;
  const minAnalysisWindowMs = 4000;
  const requiredStableWindows = 3;
  const minimumDynamicReferenceMps2 = 0.05;
  const livelyMotionRatio = 1.25;
  const recentSamples = new Array(maxRecentSamples);
  let session = null;
  let accelerometer = null;
  let deviceMotionHandler = null;
  let inactivityTimer = null;
  let lastMovementAt = 0;
  let movementDetected = false;
  let stepArmed = true;
  let lastStepAt = 0;
  let nextRecentSampleIndex = 0;
  let recentSampleCount = 0;
  let lastAutoAnalysisAt = 0;
  let pendingAutoGait = null;
  let pendingAutoGaitCount = 0;

  function persist() {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
  }

  function start(sensorMount, calibratedProfile = null) {
    const now = Date.now();
    const selectedMount = sensorProfiles[sensorMount] ? sensorMount : 'saddle';
    const autoGaitProfile = normalizeProfile(calibratedProfile);
    session = {
      startedAt: now,
      currentGait: 'walk',
      segmentStartedAt: now,
      durations: { walk: 0, trot: 0, canter: 0, pause: 0 },
      stepCounts: { walk: 0, trot: 0, canter: 0, pause: 0 },
      gaitAnalysis: emptyGaitAnalysis(),
      sensorMount: selectedMount,
      autoGaitProfile,
      autoGaitPaused: false
    };
    resetRecentSamples();
    resetSensorState();
    persist();
    console.info('[EquiCoach Sensor] Ritt gestartet', {
      sensorMount: sensorProfiles[selectedMount].label,
      stepThresholdMps2: sensorProfiles[selectedMount].threshold
    });
  }

  function restore() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return false;

    let restored;
    try {
      restored = JSON.parse(saved);
    } catch (error) {
      if (!/^\d+$/.test(saved)) throw new Error('Die gespeicherte Ritt-Erfassung ist ungültig.');
      restored = { startedAt: Number(saved) };
    }

    if (typeof restored === 'number') restored = { startedAt: restored };
    if (!Number.isFinite(restored.startedAt) || restored.startedAt <= 0) {
      throw new Error('Die gespeicherte Startzeit des Ritts ist ungültig.');
    }

    const now = Date.now();
    const durations = { walk: 0, trot: 0, canter: 0, pause: 0 };
    if (restored.durations && typeof restored.durations === 'object') {
      gaits.forEach(gait => {
        const duration = restored.durations[gait];
        if (Number.isFinite(duration) && duration >= 0) durations[gait] = duration;
      });
    }

    const currentGait = gaits.includes(restored.currentGait) ? restored.currentGait : 'walk';
    const segmentStartedAt = Number.isFinite(restored.segmentStartedAt)
      ? Math.min(restored.segmentStartedAt, now)
      : restored.startedAt;

    session = {
      startedAt: restored.startedAt,
      currentGait,
      segmentStartedAt,
      durations,
      stepCounts: gaits.reduce((counts, gait) => {
        const count = restored.stepCounts?.[gait];
        counts[gait] = Number.isSafeInteger(count) && count >= 0 ? count : 0;
        return counts;
      }, {}),
      gaitAnalysis: normalizeGaitAnalysis(restored.gaitAnalysis),
      sensorMount: sensorProfiles[restored.sensorMount] ? restored.sensorMount : 'saddle',
      autoGaitProfile: normalizeProfile(restored.autoGaitProfile),
      autoGaitPaused: restored.autoGaitPaused === true
    };
    persist();
    resetRecentSamples();
    resetSensorState();
    console.info('[EquiCoach Sensor] Ritt wiederhergestellt', {
      sensorMount: sensorProfiles[session.sensorMount].label,
      stepCounts: { ...session.stepCounts }
    });
    return true;
  }

  // Updates the current gait and records the duration of the previous gait segment.
  function setGait(gait) {
    if (!session || !gaits.includes(gait)) return false;
    const now = Date.now();
    session.durations[session.currentGait] += Math.max(0, now - session.segmentStartedAt);
    session.currentGait = gait;
    session.segmentStartedAt = now;
    session.autoGaitPaused = gait === 'pause';
    pendingAutoGait = null;
    pendingAutoGaitCount = 0;
    persist();
    return true;
  }

  function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return null;
    const normalized = {};
    for (const gait of ['walk', 'trot', 'canter']) {
      const values = profile[gait];
      if (
        !values ||
        !Number.isFinite(values.centerBpm) ||
        values.centerBpm <= 0 ||
        !Number.isFinite(values.toleranceBpm) ||
        values.toleranceBpm <= 0
      ) return null;
      normalized[gait] = {
        centerBpm: values.centerBpm,
        toleranceBpm: values.toleranceBpm,
        signalDeviation: Number.isFinite(values.signalDeviation) && values.signalDeviation > 0
          ? values.signalDeviation
          : null,
        intervalVariationPercent: Number.isFinite(values.intervalVariationPercent) &&
          values.intervalVariationPercent >= 0
          ? values.intervalVariationPercent
          : null
      };
    }
    return normalized;
  }

  function emptyGaitAnalysis() {
    return ['walk', 'trot', 'canter'].reduce((result, gait) => {
      result[gait] = {
        windows: 0,
        irregularWindows: 0,
        irregularityTotalPercent: 0,
        dynamicsRatioTotal: 0,
        livelyWindows: 0
      };
      return result;
    }, {});
  }

  function normalizeGaitAnalysis(value) {
    const result = emptyGaitAnalysis();
    if (!value || typeof value !== 'object') return result;

    Object.keys(result).forEach(gait => {
      const source = value[gait];
      if (!source || typeof source !== 'object') return;
      result[gait] = {
        windows: Number.isSafeInteger(source.windows) && source.windows >= 0 ? source.windows : 0,
        irregularWindows: Number.isSafeInteger(source.irregularWindows) && source.irregularWindows >= 0
          ? source.irregularWindows
          : 0,
        irregularityTotalPercent: Number.isFinite(source.irregularityTotalPercent) && source.irregularityTotalPercent >= 0
          ? source.irregularityTotalPercent
          : 0,
        dynamicsRatioTotal: Number.isFinite(source.dynamicsRatioTotal) && source.dynamicsRatioTotal >= 0
          ? source.dynamicsRatioTotal
          : 0,
        livelyWindows: Number.isSafeInteger(source.livelyWindows) && source.livelyWindows >= 0
          ? source.livelyWindows
          : 0
      };
      result[gait].irregularWindows = Math.min(result[gait].irregularWindows, result[gait].windows);
      result[gait].livelyWindows = Math.min(result[gait].livelyWindows, result[gait].windows);
    });
    return result;
  }

  function summarizeGaitAnalysis(value) {
    const analysis = normalizeGaitAnalysis(value);
    return Object.keys(analysis).reduce((result, gait) => {
      const stats = analysis[gait];
      result[gait] = {
        windows: stats.windows,
        irregularityPercent: stats.windows
          ? Number((stats.irregularWindows / stats.windows * 100).toFixed(1))
          : null,
        averageIntervalVariationPercent: stats.windows
          ? Number((stats.irregularityTotalPercent / stats.windows).toFixed(1))
          : null,
        averageDynamicsRatio: stats.windows
          ? Number((stats.dynamicsRatioTotal / stats.windows).toFixed(2))
          : null,
        livelyPercent: stats.windows
          ? Number((stats.livelyWindows / stats.windows * 100).toFixed(1))
          : null
      };
      return result;
    }, {});
  }

  function changeGait(gait) {
    if (!session || session.currentGait === gait) return false;
    const now = Date.now();
    session.durations[session.currentGait] += Math.max(0, now - session.segmentStartedAt);
    session.currentGait = gait;
    session.segmentStartedAt = now;
    persist();
    return true;
  }

  function stop() {
    if (!session) return null;
    const now = Date.now();
    session.durations[session.currentGait] += Math.max(0, now - session.segmentStartedAt);
    const result = {
      elapsedMs: Math.max(0, now - session.startedAt),
      durations: { ...session.durations },
      stepCounts: { ...session.stepCounts },
      gaitAnalysis: summarizeGaitAnalysis(session.gaitAnalysis),
      sensorMount: session.sensorMount
    };
    console.info('[EquiCoach Sensor] Ritt beendet', result);
    session = null;
    localStorage.removeItem(storageKey);
    stopSensor();
    return result;
  }

  function resetSensorState() {
    lastMovementAt = 0;
    movementDetected = false;
    stepArmed = true;
    lastStepAt = 0;
  }

  function resetRecentSamples() {
    nextRecentSampleIndex = 0;
    recentSampleCount = 0;
    lastAutoAnalysisAt = 0;
    pendingAutoGait = null;
    pendingAutoGaitCount = 0;
  }

  function getRecentSamples() {
    const start = (nextRecentSampleIndex - recentSampleCount + maxRecentSamples) % maxRecentSamples;
    return Array.from({ length: recentSampleCount }, (_, index) =>
      ({ ...recentSamples[(start + index) % maxRecentSamples] })
    );
  }

  function analyzeAutomaticGait(onStatus) {
    if (!session?.autoGaitProfile || session.autoGaitPaused || Date.now() - lastAutoAnalysisAt < autoAnalysisIntervalMs) return;
    if (recentSampleCount < 150) return;

    const samples = getRecentSamples();
    if (samples.length < 2 || samples[samples.length - 1].timestamp - samples[0].timestamp < minAnalysisWindowMs) return;
    lastAutoAnalysisAt = Date.now();

    const result = gaitAnalyzer.analyzeMotionSamples(samples);
    const classification = gaitAnalyzer.classifyBpmByProfile(
      result.bpm,
      result.peakCount,
      session.autoGaitProfile
    );
    if (!classification || classification.confidence < 0.25) {
      pendingAutoGait = null;
      pendingAutoGaitCount = 0;
      return;
    }

    const reference = session.autoGaitProfile[classification.gait];
    if (
      Number.isFinite(result.intervalVariationPercent) &&
      Number.isFinite(reference.intervalVariationPercent) &&
      Number.isFinite(reference.signalDeviation) &&
      reference.signalDeviation > 0
    ) {
      const stats = session.gaitAnalysis[classification.gait];
      const intervalVariation = result.intervalVariationPercent;
      const irregularThreshold = reference.intervalVariationPercent +
        Math.max(8, reference.intervalVariationPercent * 0.5);
      const dynamicsRatio = result.signalDeviation /
        Math.max(reference.signalDeviation, minimumDynamicReferenceMps2);
      const irregular = intervalVariation > irregularThreshold;
      const lively = dynamicsRatio >= livelyMotionRatio;
      stats.windows += 1;
      stats.irregularWindows += irregular ? 1 : 0;
      stats.irregularityTotalPercent += intervalVariation;
      stats.dynamicsRatioTotal += dynamicsRatio;
      stats.livelyWindows += lively ? 1 : 0;
      persist();

    }

    if (pendingAutoGait === classification.gait) {
      pendingAutoGaitCount += 1;
    } else {
      pendingAutoGait = classification.gait;
      pendingAutoGaitCount = 1;
    }

    if (pendingAutoGaitCount < requiredStableWindows || !changeGait(classification.gait)) return;

    pendingAutoGait = null;
    pendingAutoGaitCount = 0;
    const labels = { walk: 'Schritt', trot: 'Trab', canter: 'Galopp' };
    const message = `Gangart automatisch auf ${labels[classification.gait]} gestellt · Rhythmus ${classification.bpm}/min.`;
    onStatus(message);
  }

  function updateMovement(acceleration, includesGravity, onStatus, source, sampleTimestamp) {
    if (!acceleration || !Number.isFinite(acceleration.x) ||
        !Number.isFinite(acceleration.y) || !Number.isFinite(acceleration.z)) return;

    recentSamples[nextRecentSampleIndex] = {
      timestamp: Number.isFinite(sampleTimestamp) ? sampleTimestamp : performance.now(),
      x: acceleration.x,
      y: acceleration.y,
      z: acceleration.z,
      includesGravity,
      source
    };
    nextRecentSampleIndex = (nextRecentSampleIndex + 1) % maxRecentSamples;
    recentSampleCount = Math.min(recentSampleCount + 1, maxRecentSamples);
    analyzeAutomaticGait(onStatus);

    const magnitude = Math.sqrt(
      acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2
    );
    const signal = includesGravity ? Math.abs(magnitude - gravity) : magnitude;
    const profile = sensorProfiles[session.sensorMount];
    const threshold = profile.threshold;
    const now = Date.now();
    let stepDetected = false;

    if (signal < threshold * 0.55) stepArmed = true;
    if (signal >= threshold && stepArmed) {
      stepArmed = false;
      if (now - lastStepAt >= minStepIntervalMs) {
        lastStepAt = now;
        if (session.currentGait !== 'pause') {
          session.stepCounts[session.currentGait] += 1;
          stepDetected = true;
          persist();
          onStatus(sensorMessage());
        }
      }
    }

    const moving = includesGravity
      ? signal > 0.45
      : signal > 0.35;

    if (moving) lastMovementAt = now;
    const isMoving = moving || now - lastMovementAt < 1800;
    if (isMoving !== movementDetected) {
      movementDetected = isMoving;
      onStatus(sensorMessage());
    }

    if (stepDetected) {
      console.info('[EquiCoach Sensor] Schrittimpuls erkannt', {
        gait: session.currentGait,
        count: session.stepCounts[session.currentGait],
        sensorMount: profile.label
      });
    }
  }

  function sensorMessage() {
    if (session?.autoGaitProfile) {
      return session.autoGaitPaused
        ? 'Automatische Gangartwahl pausiert · Gangart über die Tasten auswählen.'
        : 'Automatische Gangartwahl aktiv · bei unsicherer Rhythmusschätzung bleibt die aktuelle Auswahl bestehen.';
    }
    return movementDetected
      ? 'Bewegung erkannt · Gangart bitte per Taste markieren. Schrittzählung ist eine Schätzung.'
      : 'Sensor verbunden · Gangart bitte per Taste markieren. Schrittzählung ist eine Schätzung.';
  }

  // Connects to the device's motion sensors and sets up event listeners for movement detection.
  async function connectSensor(onStatus) {
    if (!session) return;
    if (!window.isSecureContext) {
      onStatus('Sensorzugriff erfordert HTTPS oder localhost. Tracking per Tasten bleibt verfügbar.');
      return;
    }

    try {
      if ('Accelerometer' in window) {
        try {
          accelerometer = new window.Accelerometer({ frequency: 50 });
          const sensor = accelerometer;
          sensor.addEventListener('reading', () => {
            updateMovement(sensor, true, onStatus, 'Accelerometer', sensor.timestamp);
          });

          sensor.addEventListener('error', event => {
            accelerometer = null;
            onStatus('Accelerometer-Fehler; versuche DeviceMotion.');
            connectDeviceMotion(onStatus).catch(error => {
              onStatus(`Sensor nicht verfügbar: ${error.message} Tracking per Tasten bleibt verfügbar.`);
            });
          });
          sensor.start();
          onStatus('Accelerometer verbunden · Gangart bitte per Taste markieren.');
          console.info('[EquiCoach Sensor] Accelerometer gestartet', {
            frequencyHz: 50,
            sensorMount: sensorProfiles[session.sensorMount].label
          });
        } catch (error) {
          accelerometer = null;
          onStatus('Accelerometer nicht verfügbar; versuche DeviceMotion.');
          await connectDeviceMotion(onStatus);
        }
      } else {
        await connectDeviceMotion(onStatus);
      }

      if (accelerometer || deviceMotionHandler) {
        inactivityTimer = setInterval(() => {
          if (movementDetected && Date.now() - lastMovementAt >= 1800) {
            movementDetected = false;
            onStatus(sensorMessage());
          }
        }, 1000);
      }
    } catch (error) {
      stopSensor();
      onStatus(`Sensor nicht verfügbar: ${error.message} Tracking per Tasten bleibt verfügbar.`);
    }
  }

  async function connectDeviceMotion(onStatus) {
    if (!('DeviceMotionEvent' in window)) {
      onStatus('Kein Bewegungssensor verfügbar. Tracking per Gangart-Tasten bleibt verfügbar.');
      return;
    }

    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const permission = await DeviceMotionEvent.requestPermission();
      if (permission !== 'granted') throw new Error('Zugriff wurde nicht erlaubt.');
    }
    if (!session) return;

    deviceMotionHandler = event => {
      const hasLinearAcceleration = event.acceleration &&
        Number.isFinite(event.acceleration.x) &&
        Number.isFinite(event.acceleration.y) &&
        Number.isFinite(event.acceleration.z);
      const acceleration = hasLinearAcceleration
        ? event.acceleration
        : event.accelerationIncludingGravity;
      updateMovement(acceleration, !hasLinearAcceleration, onStatus, 'DeviceMotion', event.timeStamp);
    };
    window.addEventListener('devicemotion', deviceMotionHandler);
    onStatus('DeviceMotion verbunden · Gangart bitte per Taste markieren.');
    console.info('[EquiCoach Sensor] DeviceMotion verbunden', {
      sensorMount: sensorProfiles[session.sensorMount].label
    });
  }

  function stopSensor() {
    if (accelerometer) {
      try {
        accelerometer.stop();
      } catch (error) {
        console.warn('Accelerometer konnte nicht sauber beendet werden.', error);
      }
      accelerometer = null;
    }
    if (deviceMotionHandler) {
      window.removeEventListener('devicemotion', deviceMotionHandler);
      deviceMotionHandler = null;
    }
    if (inactivityTimer) {
      clearInterval(inactivityTimer);
      inactivityTimer = null;
    }
    resetSensorState();
  }

  return {
    start,
    restore,
    setGait,
    stop,
    connectSensor,
    isRunning: () => session !== null,
    getElapsedMs: () => session ? Math.max(0, Date.now() - session.startedAt) : 0,
    getCurrentGait: () => session && session.currentGait,
    getStepCounts: () => session ? { ...session.stepCounts } : null,
    getRecentSamples,
    getGaitAnalysisSummary: () => session ? summarizeGaitAnalysis(session.gaitAnalysis) : null,
    isAutoGaitEnabled: () => Boolean(session?.autoGaitProfile),
    isAutoGaitPaused: () => Boolean(session?.autoGaitPaused),
    getSensorMount: () => session && session.sensorMount
  };
})();
