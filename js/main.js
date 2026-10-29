window.RideTracking = (() => {
  const storageKey = 'equi_active_start';
  const gaits = ['walk', 'trot', 'canter', 'pause'];
  let session = null;
  let accelerometer = null;
  let deviceMotionHandler = null;
  let inactivityTimer = null;
  let lastMovementAt = 0;
  let movementDetected = false;

  function persist() {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
  }

  function start() {
    const now = Date.now();
    session = {
      startedAt: now,
      currentGait: 'walk',
      segmentStartedAt: now,
      durations: { walk: 0, trot: 0, canter: 0, pause: 0 }
    };
    persist();
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
      durations
    };
    persist();
    return true;
  }

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
      durations: { ...session.durations }
    };
    session = null;
    localStorage.removeItem(storageKey);
    stopSensor();
    return result;
  }

  function updateMovement(acceleration, includesGravity, onStatus) {
    if (!acceleration || !Number.isFinite(acceleration.x) ||
        !Number.isFinite(acceleration.y) || !Number.isFinite(acceleration.z)) return;

    const magnitude = Math.sqrt(
      acceleration.x ** 2 + acceleration.y ** 2 + acceleration.z ** 2
    );
    const moving = includesGravity
      ? Math.abs(magnitude - 9.81) > 0.45
      : magnitude > 0.35;

    if (moving) lastMovementAt = Date.now();
    const isMoving = moving || Date.now() - lastMovementAt < 1800;
    if (isMoving !== movementDetected) {
      movementDetected = isMoving;
      onStatus(sensorMessage());
    }
  }

  function sensorMessage() {
    return movementDetected
      ? 'Bewegung erkannt · Gangart bitte per Taste markieren.'
      : 'Sensor verbunden · Gangart bitte per Taste markieren.';
  }

  async function connectSensor(onStatus) {
    if (!session) return;
    if (!window.isSecureContext) {
      onStatus('Sensorzugriff erfordert HTTPS oder localhost. Tracking per Tasten bleibt verfügbar.');
      return;
    }

    try {
      if ('Accelerometer' in window) {
        try {
          accelerometer = new window.Accelerometer({ frequency: 10 });
          accelerometer.addEventListener('reading', () => {
            updateMovement(accelerometer, true, onStatus);
          });
          accelerometer.addEventListener('error', event => {
            accelerometer = null;
            onStatus('Accelerometer-Fehler; versuche DeviceMotion.');
            connectDeviceMotion(onStatus).catch(error => {
              onStatus(`Sensor nicht verfügbar: ${error.message} Tracking per Tasten bleibt verfügbar.`);
            });
          });
          accelerometer.start();
          onStatus('Accelerometer verbunden · Gangart bitte per Taste markieren.');
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
      updateMovement(acceleration, !event.acceleration, onStatus);
    };
    window.addEventListener('devicemotion', deviceMotionHandler);
    onStatus('DeviceMotion verbunden · Gangart bitte per Taste markieren.');
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
    movementDetected = false;
    lastMovementAt = 0;
  }

  return {
    start,
    restore,
    setGait,
    stop,
    connectSensor,
    isRunning: () => session !== null,
    getElapsedMs: () => session ? Math.max(0, Date.now() - session.startedAt) : 0,
    getCurrentGait: () => session && session.currentGait
  };
})();

(() => {
  let timerInterval = null;
  let wakeLock = null;

  window.addEventListener('DOMContentLoaded', () => {
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    if (!startBtn || !stopBtn) return;

    const timerDisplay = document.getElementById('timerDisplay');
    const diaryCard = document.getElementById('diaryCard');
    const trackingPanel = document.getElementById('trackingPanel');
    const trackingStatus = document.getElementById('trackingStatus');
    const sensorBtn = document.getElementById('sensorBtn');
    const gaitButtons = document.querySelectorAll('.gait-btn');

    startBtn.addEventListener('click', () => {
      RideTracking.start();
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      diaryCard.classList.add('hidden');
      trackingPanel.classList.remove('hidden');
      sensorBtn.classList.remove('hidden');
      setGaitButtonsEnabled(true);
      updateSelectedGait();
      requestWakeLock();
      runTimer();
      RideTracking.connectSensor(setTrackingStatus);
    });

    stopBtn.addEventListener('click', () => {
      if (!RideTracking.isRunning()) return;
      const result = RideTracking.stop();
      if (!result) return;
      window.equiLastElapsedMs = result.elapsedMs;
      clearInterval(timerInterval);
      releaseWakeLock();

      timerDisplay.innerText = '00:00';
      stopBtn.classList.add('hidden');
      startBtn.classList.remove('hidden');
      trackingPanel.classList.add('hidden');
      setGaitButtonsEnabled(false);

      document.getElementById('summaryDuration').innerText = formatTime(result.elapsedMs);
      document.getElementById('walkMin').value = minutesToInput(result.durations.walk);
      document.getElementById('trotMin').value = minutesToInput(result.durations.trot);
      document.getElementById('canterMin').value = minutesToInput(result.durations.canter);
      diaryCard.classList.remove('hidden');
    });

    gaitButtons.forEach(button => {
      button.addEventListener('click', () => {
        if (RideTracking.setGait(button.dataset.gait)) updateSelectedGait();
      });
    });

    sensorBtn.addEventListener('click', () => {
      RideTracking.connectSensor(setTrackingStatus);
    });

    if (RideTracking.restore()) {
      startBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
      trackingPanel.classList.remove('hidden');
      sensorBtn.classList.remove('hidden');
      setGaitButtonsEnabled(true);
      updateSelectedGait();
      trackingStatus.textContent = 'Ritt fortgesetzt. Bewegungssensor bei Bedarf erneut verbinden.';
      requestWakeLock();
      runTimer();
    }

    function setGaitButtonsEnabled(enabled) {
      gaitButtons.forEach(button => { button.disabled = !enabled; });
    }

    function updateSelectedGait() {
      const currentGait = RideTracking.getCurrentGait();
      gaitButtons.forEach(button => {
        button.classList.toggle('selected', button.dataset.gait === currentGait);
      });
    }

    function minutesToInput(milliseconds) {
      return (Math.round(milliseconds / 600) / 100).toFixed(2);
    }

    function setTrackingStatus(message) {
      trackingStatus.textContent = message;
      const sensorConnected = message.startsWith('Accelerometer verbunden') ||
        message.startsWith('DeviceMotion verbunden') ||
        message.startsWith('Bewegung erkannt');
      sensorBtn.classList.toggle('hidden', sensorConnected || !RideTracking.isRunning());
    }

    function runTimer() {
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        if (RideTracking.isRunning()) {
          timerDisplay.innerText = formatTime(RideTracking.getElapsedMs());
        }
      }, 500);
    }

    function formatTime(milliseconds) {
      const totalSeconds = Math.floor(milliseconds / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    async function requestWakeLock() {
      try {
        if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
      } catch (error) {
        console.warn('Bildschirmsperre konnte nicht aktiviert werden.', error);
      }
    }

    function releaseWakeLock() {
      if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
      }
    }
  });
})();
