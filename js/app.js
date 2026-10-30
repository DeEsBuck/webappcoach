(function (global) {
'use strict';

const namespace = global.EquiCoach || (global.EquiCoach = {});
const RideTracking = namespace.RideTracking;
if (!RideTracking) throw new Error('Das Ritt-Tracking-Modul wurde nicht geladen.');

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
    namespace.lastElapsedMs = result.elapsedMs;
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
}

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
    const response = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
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

function updateAnalysisView() {
  const history = getStored('equi_history');
  if (!history || history.length === 0) {
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

  let fazit = "";
  if (wPct < 30) {
    fazit += "⚠️ <b>Kurze Schrittphase:</b> Achte darauf, die Lösungsphase zu Beginn ausreichend lange zu gestalten.<br><br>";
  } else {
    fazit += "✅ <b>Gute Schrittbasis:</b> Ausreichend Aufwärmzeit gewählt.<br><br>";
  }

  if (last.rating >= 5) {
    fazit += "🌟 <b>Sehr hohe Taktreinheit (Note " + last.rating + "/6):</b> Das Taktgefühl war hervorragend.";
  } else if (last.rating >= 3) {
    fazit += "⚖️ <b>Solide Grundlage (Note " + last.rating + "/6):</b> Takt stellenweise gut, aber ausbaufähig.";
  } else {
    fazit += "🛠 <b>Fokus Taktstörung (Note " + last.rating + "/6):</b> Achte auf Losgelassenheit im Rücken.";
  }

  document.getElementById('fazitText').innerHTML = fazit;
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
