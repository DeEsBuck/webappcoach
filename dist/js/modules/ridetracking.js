window.EquiCoach = window.EquiCoach || {};
window.EquiCoach.RideTracking = (() => {
  const storageKey = 'equi_active_start';
  const gaits = ['walk', 'trot', 'canter', 'pause'];
  const sensorProfiles = {
    saddle: { label: 'Pferd / Sattel', threshold: 1.0 },
    rider: { label: 'Reiter', threshold: 1.5 },
    other: { label: 'Anderer Ort', threshold: 1.2 }
  };
  const gravity = 9.81;
  const minStepIntervalMs = 250;
  let session = null;
  let accelerometer = null;
  let deviceMotionHandler = null;
  let inactivityTimer = null;
  let lastMovementAt = 0;
  let movementDetected = false;
  let stepArmed = true;
  let lastStepAt = 0;

  function persist() {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
  }

  function start(sensorMount, debugLogging) {
    const now = Date.now();
    const selectedMount = sensorProfiles[sensorMount] ? sensorMount : 'saddle';
    session = {
      startedAt: now,
      currentGait: 'walk',
      segmentStartedAt: now,
      durations: { walk: 0, trot: 0, canter: 0, pause: 0 },
      stepCounts: { walk: 0, trot: 0, canter: 0, pause: 0 },
      sensorMount: selectedMount,
      debugLogging: debugLogging === true
    };
    resetSensorState();
    persist();
    console.info('[EquiCoach Sensor] Ritt gestartet', {
      sensorMount: sensorProfiles[selectedMount].label,
      stepThresholdMps2: sensorProfiles[selectedMount].threshold,
      debugLogging: session.debugLogging
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
      sensorMount: sensorProfiles[restored.sensorMount] ? restored.sensorMount : 'saddle',
      debugLogging: restored.debugLogging === true
    };
    persist();
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

  function updateMovement(acceleration, includesGravity, onStatus, source, sampleTimestamp) {
    if (!acceleration || !Number.isFinite(acceleration.x) ||
        !Number.isFinite(acceleration.y) || !Number.isFinite(acceleration.z)) return;

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

    if (session.debugLogging) {
      console.debug('[EquiCoach Sensor] Messwert', {
        source,
        sampleTimestamp,
        sensorMount: profile.label,
        gait: session.currentGait,
        acceleration: {
          x: acceleration.x,
          y: acceleration.y,
          z: acceleration.z
        },
        includesGravity,
        magnitudeMps2: Number(magnitude.toFixed(3)),
        movementSignalMps2: Number(signal.toFixed(3)),
        thresholdMps2: threshold,
        moving,
        stepDetected,
        stepCounts: { ...session.stepCounts }
      });
    } else if (stepDetected) {
      console.info('[EquiCoach Sensor] Schrittimpuls erkannt', {
        gait: session.currentGait,
        count: session.stepCounts[session.currentGait],
        sensorMount: profile.label
      });
    }
  }

  function sensorMessage() {
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
      const acceleration = event.acceleration || event.accelerationIncludingGravity;
      updateMovement(acceleration, !event.acceleration, onStatus, 'DeviceMotion', event.timeStamp);
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
    getSensorMount: () => session && session.sensorMount,
    getDebugLogging: () => session && session.debugLogging
  };
})();
