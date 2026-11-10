(function (global) {
'use strict';

const namespace = global.EquiCoach || (global.EquiCoach = {});
const gaitAnalyzer = namespace.GaitAnalyzer;
if (!gaitAnalyzer) throw new Error('Das Ganganalyse-Modul wurde nicht geladen.');
const SensorCalibration = namespace.SensorCalibration;
if (!SensorCalibration) throw new Error('Das Sensorkalibrierungs-Modul wurde nicht geladen.');
const RideTracking = namespace.RideTracking;
if (!RideTracking) throw new Error('Das Ritt-Tracking-Modul wurde nicht geladen.');
const Charts = namespace.Charts;
if (!Charts) throw new Error('Das Diagramm-Modul wurde nicht geladen.');

let selectedRating = 4;
const days = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

window.addEventListener('DOMContentLoaded', () => {
  setupRidingButtons();
  setupTabButtons();
  setupHistoryDelete();
  renderWeekPlan();
  loadHistory();
  updateAnalysisView();
  setupRatingButtons();
});

function setupRidingButtons() {
  let timerInterval = null;
  let wakeLock = null;

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  if (!startBtn || !stopBtn) return;

  const timerDisplay = document.getElementById('timerDisplay');
  const diaryCard = document.getElementById('diaryCard');
  const trackingPanel = document.getElementById('trackingPanel');
  const trackingStatus = document.getElementById('trackingStatus');
  const sensorBtn = document.getElementById('sensorBtn');
  const sensorMount = document.getElementById('sensorMount');
  const calibrationToggle = document.getElementById('calibrationToggle');
  const calibrationPanel = document.getElementById('calibrationPanel');
  const calibrationGait = document.getElementById('calibrationGait');
  const captureCalibrationBtn = document.getElementById('captureCalibrationBtn');
  const cancelCalibrationBtn = document.getElementById('cancelCalibrationBtn');
  const clearCalibrationBtn = document.getElementById('clearCalibrationBtn');
  const confirmCalibrationBtn = document.getElementById('confirmCalibrationBtn');
  const calibrationProgress = document.getElementById('calibrationProgress');
  const calibrationStatus = document.getElementById('calibrationStatus');
  const calibrationResults = document.getElementById('calibrationResults');
  const gaitModeStatus = document.getElementById('gaitModeStatus');
  const gaitMotionStatus = document.getElementById('gaitMotionStatus');
  const liveStepCounts = document.getElementById('liveStepCounts');
  const gaitButtons = document.querySelectorAll('.gait-btn');
  const gaitLabels = { walk: 'Schritt', trot: 'Trab', canter: 'Galopp' };

  renderCalibrationResults();
  calibrationToggle.addEventListener('click', () => {
    const opening = calibrationPanel.classList.contains('hidden');
    calibrationPanel.classList.toggle('hidden', !opening);
    if (opening) renderCalibrationResults();
  });
  sensorMount.addEventListener('change', renderCalibrationResults);

  captureCalibrationBtn.addEventListener('click', async () => {
    setCalibrationControls(true);
    calibrationProgress.value = 0;
    calibrationProgress.classList.remove('hidden');
    calibrationStatus.textContent = 'Sensor wird verbunden. Halte die gewählte Gangart während der 100-Sekunden-Aufnahme möglichst gleichmäßig.';

    try {
      const result = await SensorCalibration.capture(
        sensorMount.value,
        calibrationGait.value,
        progress => { calibrationProgress.value = progress; }
      );
      const gait = gaitLabels[calibrationGait.value];
      const bpm = result.capture.analysis.bpm;
      calibrationStatus.textContent = `${gait}-Messung lokal gespeichert (${result.capture.sampleCount} Messwerte, einmalig 100 Sekunden` +
        `${bpm ? `, Analyzer-Rhythmus ${bpm}/min` : ', noch kein klarer Rhythmus erkannt'}` +
        `${result.replacedOldest ? ', vorherige Messung ersetzt' : ''}). CSV-Rohdaten stehen in der Browserkonsole.`;
      renderCalibrationResults();
    } catch (error) {
      calibrationStatus.textContent = error.name === 'AbortError'
        ? 'Aufnahme abgebrochen; es wurde keine Messung gespeichert.'
        : error.message;
    } finally {
      setCalibrationControls(false);
      calibrationProgress.classList.add('hidden');
    }
  });

  cancelCalibrationBtn.addEventListener('click', () => SensorCalibration.cancel());

  confirmCalibrationBtn.addEventListener('click', () => {
    if (!window.confirm(
      'Kalibrierung für diese Sensorposition bestätigen und die automatische Gangartwahl aktivieren? ' +
      'Die Erkennung bleibt experimentell und kann sich irren.'
    )) return;
    try {
      SensorCalibration.confirm(sensorMount.value);
      calibrationStatus.textContent = 'Kalibrierung bestätigt. Die automatische Gangartwahl wird beim nächsten Ritt aktiviert.';
      renderCalibrationResults();
    } catch (error) {
      calibrationStatus.textContent = `Automatische Gangartwahl konnte nicht aktiviert werden: ${error.message}`;
      renderCalibrationResults();
    }
  });

  clearCalibrationBtn.addEventListener('click', () => {
    if (!window.confirm('Alle lokalen Kalibrierungsmessungen für diese Sensorposition löschen?')) return;
    try {
      SensorCalibration.clearMount(sensorMount.value);
      calibrationStatus.textContent = 'Lokale Messungen dieser Sensorposition wurden gelöscht.';
      renderCalibrationResults();
    } catch (error) {
      calibrationStatus.textContent = `Kalibrierung konnte nicht gelöscht werden: ${error.message}`;
    }
  });

  function setCalibrationControls(disabled) {
    captureCalibrationBtn.disabled = disabled;
    clearCalibrationBtn.disabled = disabled;
    if (disabled) {
      confirmCalibrationBtn.disabled = true;
    } else {
      try {
        confirmCalibrationBtn.disabled = !SensorCalibration.getSummary(sensorMount.value).ready;
      } catch (error) {
        confirmCalibrationBtn.disabled = true;
        calibrationStatus.textContent = `Lokale Kalibrierungsdaten konnten nicht gelesen werden: ${error.message}`;
      }
    }
    calibrationToggle.disabled = disabled;
    sensorMount.disabled = disabled;
    calibrationGait.disabled = disabled;
    startBtn.disabled = disabled;
    cancelCalibrationBtn.classList.toggle('hidden', !disabled);
  }

  function renderCalibrationResults() {
    try {
      const summary = SensorCalibration.getSummary(sensorMount.value);
      confirmCalibrationBtn.disabled = !summary.ready;
      calibrationResults.replaceChildren();
      calibrationStatus.textContent = summary.confirmed
        ? 'Kalibrierung für diese Sensorposition bestätigt. Eine neue Messung hebt die Bestätigung auf.'
        : summary.ready
          ? 'Messungen sind auswertbar. Bestätige die Kalibrierung, um automatische Gangartwahl zu aktivieren.'
          : summary.reason || 'Für die automatische Gangartwahl fehlen noch verwertbare Vergleichsmessungen.';
      Object.entries(gaitLabels).forEach(([gait, label]) => {
        const captures = summary[gait];
        const row = document.createElement('div');
        row.className = 'calibration-result';
        const heading = document.createElement('strong');
        heading.textContent = `${label}: ${captures.length}/${SensorCalibration.maxCapturesPerGait} Messung`;
        row.appendChild(heading);
        captures.forEach((capture, index) => {
          const detail = document.createElement('div');
          const { analysis } = capture;
          const agreement = analysis.label === label ? 'passt zur Markierung' : 'weicht von der Markierung ab';
          const intervalVariation = Number.isFinite(analysis.intervalVariationPercent)
            ? ` · Intervallstreuung ${analysis.intervalVariationPercent.toFixed(1)}%`
            : '';
          const signalDeviation = Number.isFinite(analysis.signalDeviation)
            ? ` · Beschleunigungsstreuung ${analysis.signalDeviation.toFixed(2)} m/s²`
            : '';
          detail.textContent = `${analysis.bpm || '—'} Impulse/min · Analyzer: ${analysis.label} (${agreement})${intervalVariation}${signalDeviation} · ${capture.sampleCount} Werte`;
          row.appendChild(detail);
        });
        calibrationResults.appendChild(row);
      });
    } catch (error) {
      confirmCalibrationBtn.disabled = true;
      calibrationResults.textContent = `Lokale Kalibrierungsdaten konnten nicht gelesen werden: ${error.message}`;
    }
  }

  function updateGaitModeStatus() {
    if (!RideTracking.isAutoGaitEnabled()) {
      gaitModeStatus.textContent = 'Manuelle Gangartwahl aktiv · keine bestätigte Kalibrierung für diese Sensorposition.';
      gaitMotionStatus.textContent = 'Keine bestätigte Kalibrierung: Rhythmusunregelmäßigkeit und Bewegungsdynamik werden nicht bewertet.';
    } else if (RideTracking.isAutoGaitPaused()) {
      gaitModeStatus.textContent = 'Automatische Gangartwahl pausiert · eine aktive Gangart-Taste setzt sie fort.';
      gaitMotionStatus.textContent = 'Analyse pausiert. Eine aktive Gangart-Taste setzt die kalibrierte Vergleichsanalyse fort.';
    } else {
      gaitModeStatus.textContent = 'Automatische Gangartwahl aktiv (kalibriert) · bei unsicherer Schätzung bleibt die aktuelle Auswahl bestehen. Pause bleibt manuell.';
      gaitMotionStatus.textContent = 'Warte auf ausreichend klare Rhythmusfenster für den Kalibrierungsvergleich.';
    }
  }

  function updateGaitAnalysisDisplay() {
    renderGaitAnalysisSummary(gaitMotionStatus, RideTracking.getGaitAnalysisSummary(), {
      live: true,
      enabled: RideTracking.isAutoGaitEnabled(),
      paused: RideTracking.isAutoGaitPaused()
    });
  }

  startBtn.addEventListener('click', () => {
    let calibratedProfile;
    try {
      calibratedProfile = SensorCalibration.getConfirmedProfile(sensorMount.value);
    } catch (error) {
      calibrationStatus.textContent = `Lokale Kalibrierung konnte nicht gelesen werden: ${error.message}`;
      calibrationPanel.classList.remove('hidden');
      return;
    }
    RideTracking.start(sensorMount.value, calibratedProfile);
    namespace.lastStepCounts = null;
    namespace.lastSensorMount = null;
    namespace.lastGaitAnalysis = null;
    sensorMount.disabled = true;
    calibrationToggle.disabled = true;
    calibrationPanel.classList.add('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    diaryCard.classList.add('hidden');
    trackingPanel.classList.remove('hidden');
    sensorBtn.classList.remove('hidden');
    updateGaitModeStatus();
    setGaitButtonsEnabled(true);
    updateSelectedGait();
    requestWakeLock();
    runTimer();
    updateStepCounts();
    RideTracking.connectSensor(setTrackingStatus);
  });

  stopBtn.addEventListener('click', () => {
    if (!RideTracking.isRunning()) return;
    const result = RideTracking.stop();
    if (!result) return;
    namespace.lastElapsedMs = result.elapsedMs;
    namespace.lastStepCounts = result.stepCounts;
    namespace.lastSensorMount = result.sensorMount;
    namespace.lastGaitAnalysis = result.gaitAnalysis;
    clearInterval(timerInterval);
    releaseWakeLock();
    sensorMount.disabled = false;
    calibrationToggle.disabled = false;

    timerDisplay.innerText = '00:00';
    stopBtn.classList.add('hidden');
    startBtn.classList.remove('hidden');
    trackingPanel.classList.add('hidden');
    setGaitButtonsEnabled(false);

    document.getElementById('summaryDuration').innerText = formatTime(result.elapsedMs);
    document.getElementById('stepSummary').textContent = formatStepCounts(result.stepCounts);
    renderGaitAnalysisSummary(document.getElementById('gaitAnalysisResult'), result.gaitAnalysis);
    Charts.renderMotionAnalysisChart(
      document.getElementById('rideMotionAnalysisChart'),
      result.gaitAnalysis
    );
    document.getElementById('walkMin').value = minutesToInput(result.durations.walk);
    document.getElementById('trotMin').value = minutesToInput(result.durations.trot);
    document.getElementById('canterMin').value = minutesToInput(result.durations.canter);
    diaryCard.classList.remove('hidden');
  });

  gaitButtons.forEach(button => {
    button.addEventListener('click', () => {
      if (RideTracking.setGait(button.dataset.gait)) {
        updateSelectedGait();
        updateStepCounts();
        updateGaitModeStatus();
      }
    });
  });

  // TODO: Sollte man als Fallback oder Test nutzen, falls ein Sensor verfügbar ist. Ansonsten müsse das von App selsbt entschieden werden und nicht vom Nutzer.
  sensorBtn.addEventListener('click', () => {
    RideTracking.connectSensor(setTrackingStatus);
  });

  if (RideTracking.restore()) {
    sensorMount.value = RideTracking.getSensorMount();
    sensorMount.disabled = true;
    calibrationToggle.disabled = true;
    calibrationPanel.classList.add('hidden');
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');
    trackingPanel.classList.remove('hidden');
    sensorBtn.classList.remove('hidden');
    updateGaitModeStatus();
    setGaitButtonsEnabled(true);
    updateSelectedGait();
    trackingStatus.textContent = 'Ritt fortgesetzt. Bewegungssensor bei Bedarf erneut verbinden.';
    updateStepCounts();
    requestWakeLock();
    runTimer();
  }

  function setGaitButtonsEnabled(enabled) {
    gaitButtons.forEach(button => { button.disabled = !enabled; });
  }

  // Updates the selected gait button based on the current gait from RideTracking.
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
    updateStepCounts();
    updateSelectedGait();
    const sensorConnected = message.startsWith('Accelerometer verbunden') ||
      message.startsWith('DeviceMotion verbunden') ||
      message.startsWith('Bewegung erkannt') ||
      message.startsWith('Automatische Gangartwahl') ||
      message.startsWith('Gangart automatisch');
    sensorBtn.classList.toggle('hidden', sensorConnected || !RideTracking.isRunning());
  }

  function updateStepCounts() {
    const counts = RideTracking.getStepCounts();
    if (counts) liveStepCounts.textContent = `Erkannte Schrittimpulse (Schätzung): ${formatStepCounts(counts)}`;
  }

  function formatStepCounts(counts) {
    return `Schritt ${counts.walk || 0} · Trab ${counts.trot || 0} · Galopp ${counts.canter || 0}`;
  }

  function runTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (RideTracking.isRunning()) {
        timerDisplay.innerText = formatTime(RideTracking.getElapsedMs());
        updateGaitAnalysisDisplay();
      }
    }, 1000);
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
}

// TODO: Sollte von App selsbt durch Analyse Regeln entschieden werden und nicht vom Nutzer.
function setupRatingButtons() {
  const ratingBtns = document.querySelectorAll('.rating-btn');
  ratingBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      ratingBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedRating = parseInt(btn.getAttribute('data-val'), 10) || 4;
    });
  });
}

function switchTab(tabName) {
  document.querySelectorAll('.section-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
  
  const targetPage = document.getElementById('page-' + tabName);
  if (targetPage) targetPage.classList.add('active');
  
  const btnIndex = ['ride', 'ai', 'analysis', 'plan', 'history'].indexOf(tabName);
  if (btnIndex !== -1) {
    document.querySelectorAll('.tab-bar .tab-btn')[btnIndex].classList.add('active');
  }

  if (tabName === 'analysis') updateAnalysisView();
  if (tabName === 'history') loadHistory();
}

function setupTabButtons() {
  document.querySelectorAll('.tab-bar .tab-btn').forEach(button => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });
}

document.getElementById('saveBtn').addEventListener('click', () => {
  const walk = parseFloat(document.getElementById('walkMin').value) || 0;
  const trot = parseFloat(document.getElementById('trotMin').value) || 0;
  const canter = parseFloat(document.getElementById('canterMin').value) || 0;
  const note = document.getElementById('noteInput').value.trim();

  const newEntry = {
    id: Date.now(),
    date: new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }),
    duration: formatTime(namespace.lastElapsedMs || ((walk + trot + canter) * 60000)),
    walk: walk,
    trot: trot,
    canter: canter,
    rating: selectedRating,
    stepCounts: namespace.lastStepCounts,
    sensorMount: namespace.lastSensorMount,
    gaitAnalysis: namespace.lastGaitAnalysis,
    note: note || 'Keine Anmerkungen.'
  };

  const history = getStored('equi_history');
  history.unshift(newEntry);
  localStorage.setItem('equi_history', JSON.stringify(history));

  document.getElementById('noteInput').value = '';
  document.getElementById('diaryCard').classList.add('hidden');
  
  loadHistory();
  switchTab('analysis');
});

function formatTime(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

document.getElementById('askAiBtn').addEventListener('click', async () => {
  // TODO: Hier könnte man die Antwort noch weiter verarbeiten, z.B. HTML-Formatierung, Markdown, etc.
  const question = document.getElementById('aiQuestion').value.trim();
  const chatOutput = document.getElementById('chatOutput');
  const askAiBtn = document.getElementById('askAiBtn');

  if (!question) {
    chatOutput.textContent = 'Bitte gib zuerst eine Frage ein.';
    return;
  }

  chatOutput.textContent = 'Der KI-Coach denkt nach...';
  askAiBtn.disabled = true;

  try {
    // API-Schlüssel niemals im Browser abfragen, speichern oder direkt an Gemini senden:
    // Clientseitige Schlüssel sind sichtbar und keine sichere Lösung für eine veröffentlichte App.
    // Der Serverless-Endpunkt liest den Schlüssel aus einer serverseitigen Umgebungsvariable.
    const trainingMetadata = global.equiMetadata.collectTrainingMetadata();
    const response = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, trainingMetadata })
    });

    const responseText = await response.text();
    let data;
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch (error) {
      if (!response.ok) {
        throw new Error(`Der API-Endpunkt antwortete mit HTTP ${response.status}.`);
      }
      throw new Error('Der API-Endpunkt lieferte keine gültige JSON-Antwort.');
    }
    if (!response.ok) {
      throw new Error(data.error || `Der API-Endpunkt antwortete mit HTTP ${response.status}.`);
    }
    if (typeof data.answer !== 'string' || !data.answer.trim()) {
      throw new Error('Die Antwort des API-Endpunkts hat nicht das erwartete Format.');
    }

    chatOutput.textContent = `Antwort vom KI-Coach:\n\n${data.answer}`;
    document.getElementById('aiQuestion').value = '';
  } catch (error) {
    chatOutput.textContent = `Fehler beim KI-Coach: ${error.message}`;
  } finally {
    askAiBtn.disabled = false;
  }
});


// Reit-Analyse-Output: Zusammenfassung der Reitaktivitäten und Bewertung. Keine Berechnungen
function updateAnalysisView() {
  const history = getStored('equi_history');
  Charts.renderRideHistoryChart(document.getElementById('rideHistoryChart'), history);
  renderGaitAnalysisSummary(
    document.getElementById('motionAnalysisSummary'),
    history[0]?.gaitAnalysis
  );
  Charts.renderMotionAnalysisChart(
    document.getElementById('motionAnalysisChart'),
    history[0]?.gaitAnalysis
  );
  if (!history || history.length === 0) {
    document.getElementById('latestRating').textContent = '—';
    document.getElementById('noAnalysisMsg').classList.remove('hidden');
    document.getElementById('analysisContent').classList.add('hidden');
    return;
  }

  document.getElementById('noAnalysisMsg').classList.add('hidden');
  document.getElementById('analysisContent').classList.remove('hidden');

  const last = history[0];
  const total = (last.walk + last.trot + last.canter) || 1;

  const wPct = Math.round((last.walk / total) * 100);
  const tPct = Math.round((last.trot / total) * 100);
  const cPct = Math.round((last.canter / total) * 100);

  document.getElementById('walkPct').innerText = wPct + '%';
  document.getElementById('trotPct').innerText = tPct + '%';
  document.getElementById('canterPct').innerText = cPct + '%';

  document.getElementById('walkBar').style.width = wPct + '%';
  document.getElementById('trotBar').style.width = tPct + '%';
  document.getElementById('canterBar').style.width = cPct + '%';
  const rating = Number(last.rating);
  const hasRating = Number.isInteger(rating) && rating >= 1 && rating <= 6;
  const ratingLabel = hasRating
    ? rating >= 5
      ? 'Sehr gut'
      : rating >= 3
        ? 'Solide'
        : 'Ausbaufähig'
    : 'Keine Bewertung';
  document.getElementById('latestRating').textContent = hasRating
    ? `${rating}/6 · ${ratingLabel}`
    : ratingLabel;

  // TODO: Kann man weitere Kommentare erweitern, z.B. basierend auf der Taktbewertung, der Schrittphase oder den Notizen des Reiters.
  let fazit = "";
  if (wPct < 30) {
    fazit += "⚠️ <b>Kurze Schrittphase:</b> Achte darauf, die Lösungsphase zu Beginn ausreichend lange zu gestalten.<br><br>";
  } else {
    fazit += "✅ <b>Gute Schrittbasis:</b> Ausreichend Aufwärmzeit gewählt.<br><br>";
  }

  if (!hasRating) {
    fazit += "Für diesen Ritt wurde keine gültige Takt- und Schwunggefühl-Bewertung gespeichert.";
  } else if (rating >= 5) {
    fazit += `🌟 <b>Sehr hohe Taktreinheit (Bewertung ${rating}/6):</b> Das Taktgefühl war hervorragend.`;
  } else if (rating >= 3) {
    fazit += `⚖️ <b>Solide Grundlage (Bewertung ${rating}/6):</b> Takt stellenweise gut, aber ausbaufähig.`;
  } else {
    fazit += `🛠 <b>Fokus Taktgefühl (Bewertung ${rating}/6):</b> Achte auf Losgelassenheit im Rücken.`;
  }

  document.getElementById('fazitText').innerHTML = fazit;
}

function renderGaitAnalysisSummary(container, analysis, options = {}) {
  if (!container) return;
  container.replaceChildren();

  const labels = { walk: 'Schritt', trot: 'Trab', canter: 'Galopp' };
  const entries = Object.entries(labels)
    .map(([gait, label]) => ({ label, stats: analysis?.[gait] }))
    .filter(({ stats }) => stats && Number.isSafeInteger(stats.windows) && stats.windows > 0);

  if (!entries.length) {
    const message = options.live
      ? !options.enabled
        ? 'Keine bestätigte Kalibrierung: Es werden keine Sensorvergleiche berechnet.'
        : options.paused
          ? 'Analyse pausiert. Eine aktive Gangart-Taste setzt sie fort.'
          : 'Warte auf ausreichend klare Rhythmusfenster für den Kalibrierungsvergleich.'
      : 'Für diesen Ritt liegen keine auswertbaren kalibrierten Sensorfenster vor.';
    container.textContent = message;
    return;
  }

  entries.forEach(({ label, stats }) => {
    const item = document.createElement('p');
    const irregularity = Number.isFinite(stats.irregularityPercent)
      ? `${stats.irregularityPercent.toFixed(1)}% der Fenster auffällig`
      : 'keine Rhythmuswerte';
    const intervalVariation = Number.isFinite(stats.averageIntervalVariationPercent)
      ? `mittlere Intervallstreuung ${stats.averageIntervalVariationPercent.toFixed(1)}%`
      : '';
    const lively = Number.isFinite(stats.livelyPercent)
      ? `${stats.livelyPercent.toFixed(1)}% der Fenster mit erhöhter Beschleunigungsdynamik`
      : 'keine Beschleunigungswerte';
    const ratio = Number.isFinite(stats.averageDynamicsRatio)
      ? ` (im Mittel ${stats.averageDynamicsRatio.toFixed(2)}× Kalibrierungswert)`
      : '';
    item.textContent = `${label}: ${stats.windows} ausgewertete Fenster · ${irregularity}` +
      `${intervalVariation ? `, ${intervalVariation}` : ''} · ${lively}${ratio}.`;
    container.appendChild(item);
  });
  if (options.live && options.paused) {
    const paused = document.createElement('p');
    paused.textContent = 'Analyse pausiert. Eine aktive Gangart-Taste setzt sie fort.';
    container.appendChild(paused);
  }
}

function renderWeekPlan() {
  const container = document.getElementById('weekPlanContainer');
  const plan = getStored('equi_plan');
  container.innerHTML = '';

  days.forEach((day, idx) => {
    const item = plan[idx] || { text: '', done: false };
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="day-name">${day.substring(0,2)}</span>
      <input type="text" class="day-input" id="plan-input-${idx}" value="${escapeHtml(item.text)}" placeholder="z.B. Stangenarbeit">
      <input type="checkbox" class="day-check" id="plan-check-${idx}" ${item.done ? 'checked' : ''}>
    `;
    container.appendChild(row);
  });
}

// TODO: der Trainingplan sollte auch für metadata gespeichert werden, damit er in der KI-Analyse berücksichtigt werden kann
document.getElementById('savePlanBtn').addEventListener('click', () => {
  const plan = days.map((_, idx) => ({
    text: document.getElementById(`plan-input-${idx}`).value,
    done: document.getElementById(`plan-check-${idx}`).checked
  }));
  localStorage.setItem('equi_plan', JSON.stringify(plan));
  alert("Trainingsplan erfolgreich gespeichert!");
});

function loadHistory() {
  const container = document.getElementById('historyContainer');
  const history = getStored('equi_history');
  container.innerHTML = '';

  if (!history || history.length === 0) {
    container.innerHTML = '<div style="color:#8A99AD; text-align:center;">Noch keine Einträge.</div>';
    return;
  }

  history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-header">
        <span>📅 ${item.date}</span>
        <span style="color:#FFE57F; font-weight:bold;">⏱ ${item.duration}</span>
        <button class="btn-delete" data-entry-id="${item.id}">Löschen</button>
      </div>
      <div style="font-size:0.85rem; color:#D4AF37; margin-bottom:4px;">
        Takt-Note: <b>${item.rating}/6</b> | S: ${item.walk}m / T: ${item.trot}m / G: ${item.canter}m
      </div>
      ${item.stepCounts ? `<div style="font-size:0.85rem; color:#8A99AD; margin-bottom:4px;">Schrittimpulse (Schätzung): ${escapeHtml(formatStepCounts(item.stepCounts))}</div>` : ''}
      ${item.sensorMount ? `<div style="font-size:0.8rem; color:#8A99AD; margin-bottom:4px;">Sensorposition: ${escapeHtml(formatSensorMount(item.sensorMount))}</div>` : ''}
      <div style="font-size:0.9rem; color:#E2E8F0;">${escapeHtml(item.note)}</div>
    `;
    container.appendChild(div);
  });
}

function deleteEntry(id) {
  if (!Number.isSafeInteger(id)) return;
  if (confirm("Eintrag löschen?")) {
    let history = getStored('equi_history');
    history = history.filter(item => item.id !== id);
    localStorage.setItem('equi_history', JSON.stringify(history));
    loadHistory();
    updateAnalysisView();
  }
}

function setupHistoryDelete() {
  const container = document.getElementById('historyContainer');
  container.addEventListener('click', event => {
    const button = event.target.closest('.btn-delete');
    if (button) deleteEntry(Number(button.dataset.entryId));
  });
}

function formatStepCounts(counts) {
  const safeCount = gait => Number.isSafeInteger(counts?.[gait]) && counts[gait] >= 0
    ? counts[gait]
    : 0;
  return `Schritt ${safeCount('walk')} · Trab ${safeCount('trot')} · Galopp ${safeCount('canter')}`;
}

function formatSensorMount(sensorMount) {
  return {
    saddle: 'Pferd / Sattel',
    rider: 'Reiter',
    other: 'Anderer Ort'
  }[sensorMount] || 'Unbekannt';
}

function getStored(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}
})(window);
