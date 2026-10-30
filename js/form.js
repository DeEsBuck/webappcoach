// Regelbasierte Orientierung zu den ersten drei Stufen der Ausbildungsskala.
// Die Angaben bleiben im Browser und werden nicht an einen Server übertragen.
var STAGE_INFO = {
  takt: {
    label: 'Stufe 1: Takt',
    keywords: ['rennt', 'stürmt', 'hektisch', 'eilt', 'tempo', 'schnell', 'kontrolle', 'wegrennen', 'preschen', 'ungleichmäßig', 'unregelmäßig', 'davon', 'losstürmt'],
    signals: [
      { id: 'eilt', label: 'eilt oder rennt' },
      { id: 'hektisch', label: 'wirkt hektisch oder das Tempo ist schwer zu regulieren' },
      { id: 'unregelmaessig', label: 'der Takt wirkt unregelmäßig' }
    ],
    exercises: [
      'Viele Übergänge zwischen den Gangarten reiten, um das Pferd auf die eigene Grundbewegung zu fokussieren',
      'Große, weite Zirkel statt enger Wendungen – erst wenn der Takt stabil ist, die Bahnfiguren enger werden lassen',
      'Tempo bewusst variieren (schneller/langsamer im gleichen Takt) statt nur zu bremsen',
      'Longenarbeit ohne Reitergewicht nutzen, um zu prüfen, ob der Takt auch ohne Reiter unregelmäßig ist'
    ]
  },
  losgelassenheit: {
    label: 'Stufe 2: Losgelassenheit',
    keywords: ['verspannt', 'fest im rücken', 'klemmt', 'hochreißen', 'kopf hoch', 'angespannt', 'steif', 'festhalten', 'blockiert', 'macht sich fest'],
    signals: [
      { id: 'verspannt', label: 'wirkt verspannt oder steif' },
      { id: 'ruecken', label: 'der Rücken wirkt fest oder blockiert' },
      { id: 'kopf', label: 'hebt oder reißt den Kopf hoch' }
    ],
    exercises: [
      'Vorwärts-abwärts Reiten zur Lösung der Rückenmuskulatur',
      'Übergänge und Handwechsel in ruhigem Tempo, um Verspannungen zu lösen',
      'Lösungsphase am Anfang jeder Einheit bewusst verlängern, bevor anspruchsvollere Arbeit folgt',
      'Auf den eigenen Sitz achten: löst sich der Reiter selbst, überträgt sich das oft aufs Pferd'
    ]
  },
  anlehnung: {
    label: 'Stufe 3: Anlehnung',
    keywords: ['vorhand', 'zügel', 'anlehnung', 'gegen die hand', 'rüde', 'wirft den kopf', 'sucht keine anlehnung', 'drückt'],
    signals: [
      { id: 'gegenhand', label: 'drückt gegen die Hand' },
      { id: 'kopf', label: 'wirft oder schüttelt den Kopf' },
      { id: 'verbindung', label: 'die Zügelverbindung oder Anlehnung ist schwierig' }
    ],
    exercises: [
      'Gleichmäßige, weiche Zügelverbindung erarbeiten, ohne festzuhalten',
      'Übergänge nutzen, um das Pferd ans Gebiss heranzureiten statt es zurückzunehmen',
      'Stangenarbeit zur Förderung von mehr Aktivität aus der Hinterhand in die Anlehnung',
      'Kontrollieren, ob Gebiss und Ausrüstung wirklich passen, bevor an der Anlehnung weitergearbeitet wird'
    ]
  }
};

var FORM_LABELS = {
  geschlecht: { stute: 'Stute', wallach: 'Wallach', hengst: 'Hengst' },
  ausbildungsstand: {
    jungpferd: 'Jungpferd / Anfänger',
    fortgeschritten: 'Fortgeschritten',
    turnier: 'Turniererfahren'
  },
  konsistenz: {
    immer: 'Jedes Mal',
    manchmal: 'Nur manchmal',
    situativ: 'Nur in bestimmten Situationen'
  },
  kontext: {
    nur_sattel: 'Nur unter dem Sattel',
    auch_boden: 'Auch bei Bodenarbeit'
  },
  ziel: {
    sicherheit: 'Mehr Sicherheit',
    ruhe: 'Ein ruhigeres Pferd',
    basis: 'Eine bessere gemeinsame Basis'
  },
  gangarten: { schritt: 'Schritt', trab: 'Trab', galopp: 'Galopp' }
};

var submitButton = document.getElementById('submitBtn');
if (!submitButton) throw new Error('Das Formular benötigt einen Button mit der ID "submitBtn".');
submitButton.addEventListener('click', submitDiagnose);

function submitDiagnose() {
  var symptom = document.getElementById('symptom').value.trim();
  var selectedSignals = Array.from(
    document.querySelectorAll('input[name="symptomSignal"]:checked')
  ).map(function (input) { return input.value; });
  var errEl = document.getElementById('err-symptom');

  if (!symptom && selectedSignals.length === 0) {
    errEl.style.display = 'block';
    document.getElementById('symptom').focus();
    return;
  }
  errEl.style.display = 'none';

  var data = {
    name: document.getElementById('pname').value.trim() || 'dein Pferd',
    alter: document.getElementById('page').value.trim(),
    geschlecht: document.getElementById('psex').value,
    rasse: document.getElementById('pbreed').value.trim(),
    ausruestung: document.getElementById('pgear').value.trim(),
    ausbildungsstand: document.getElementById('plevel').value,
    symptom: symptom,
    selectedSignals: selectedSignals,
    gangarten: Array.from(
      document.querySelectorAll('input[name="gait"]:checked')
    ).map(function (input) { return input.value; }),
    konsistenz: document.getElementById('consistency').value,
    kontext: document.getElementById('context').value,
    gesundheitGeprueft: document.getElementById('health').checked,
    reaktion: document.getElementById('reaction').value.trim(),
    ziel: document.getElementById('goal').value
  };

  renderResult(data, diagnose(data));
}

function diagnose(data) {
  var normalizedText = normalizeText(data.symptom);
  var selectedSignals = new Set(data.selectedSignals);
  var scores = { takt: 0, losgelassenheit: 0, anlehnung: 0 };
  var matched = { takt: [], losgelassenheit: [], anlehnung: [] };

  Object.keys(STAGE_INFO).forEach(function (stage) {
    STAGE_INFO[stage].signals.forEach(function (signal) {
      if (selectedSignals.has(stage + ':' + signal.id)) {
        scores[stage] += 1;
        matched[stage].push(signal.label);
      }
    });

    STAGE_INFO[stage].keywords.forEach(function (keyword) {
      var normalizedKeyword = normalizeText(keyword);
      if (containsPhrase(normalizedText, normalizedKeyword)) {
        scores[stage] += 1;
        matched[stage].push('„' + keyword + '“');
      }
    });
  });

  if (data.gangarten.length >= 2) scores.takt += 1;
  if (data.konsistenz === 'immer') scores.takt += 1;
  if (data.kontext === 'auch_boden') scores.takt += 1;

  var bestScore = Math.max.apply(null, Object.values(scores));
  var candidates = bestScore > 0
    ? Object.keys(scores).filter(function (stage) { return scores[stage] === bestScore; })
    : [];

  return {
    stage: candidates.length === 1 ? candidates[0] : null,
    candidates: candidates,
    score: bestScore,
    matched: matched,
    exercises: candidates.length === 1 ? STAGE_INFO[candidates[0]].exercises : [],
    healthChecked: data.gesundheitGeprueft
  };
}

function normalizeText(text) {
  return text.toLocaleLowerCase('de-DE')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function containsPhrase(text, phrase) {
  return (' ' + text + ' ').indexOf(' ' + phrase + ' ') !== -1;
}

function renderResult(data, diagnosis) {
  var box = document.getElementById('resultBox');
  var html = '<p style="margin:0 0 8px; font-weight:600;">Ergebnis für ' +
    escapeHtml(data.name) + '</p>';

  try {
    window.equiMetadata.saveEntryAnalysis(data, diagnosis);
  } catch (error) {
    console.error('Die Einstiegsanalyse konnte nicht für den EquiCoach gespeichert werden.', error);
    html += '<p role="alert">Die Einstiegsanalyse konnte nicht für den EquiCoach gespeichert werden: ' +
      escapeHtml(error.message) + '</p>';
  }

  if (!diagnosis.healthChecked) {
    html += '<p style="background:var(--bg-warning); color:var(--text-warning); padding:8px 10px; border-radius:var(--radius); margin:0 0 10px;">' +
      'Bitte zuerst gesundheitliche Ursachen (Sattel, Zähne, Rücken) ausschließen lassen – die folgende Einschätzung ersetzt keine tierärztliche Abklärung.</p>';
  }

  if (data.symptom) {
    html += '<p><strong>Deine Beobachtung:</strong> ' + escapeHtml(data.symptom) + '</p>';
  }

  if (diagnosis.candidates.length > 1) {
    html += '<p>Die Hinweise passen gleich stark zu mehreren möglichen Schwerpunkten. Daher wird keine einzelne Stufe bevorzugt:</p><ul>';
    diagnosis.candidates.forEach(function (stage) {
      html += '<li><strong>' + STAGE_INFO[stage].label + '</strong> – ' +
        escapeHtml(diagnosis.matched[stage].join(', ')) + '</li>';
    });
    html += '</ul><p>Beobachte, wann die Schwierigkeit auftritt und ob sie sich in verschiedenen Situationen wiederholt.</p>';
  } else if (diagnosis.stage) {
    var info = STAGE_INFO[diagnosis.stage];
    html += '<p>Vermuteter Schwerpunkt: <strong>' + info.label + '</strong></p>';
    html += '<p style="color:var(--text-secondary);">Hinweise: ' +
      escapeHtml(diagnosis.matched[diagnosis.stage].join(', ')) + '</p>';
    html += '<p><strong>Mögliche erste Übungen:</strong></p><ul>';
    diagnosis.exercises.forEach(function (exercise) {
      html += '<li style="margin-bottom:6px;">' + escapeHtml(exercise) + '</li>';
    });
    html += '</ul>';
  } else {
    html += '<p>Aus den auswählbaren Hinweisen lässt sich noch kein eindeutiger Schwerpunkt ableiten. Beschreibe möglichst konkret, was passiert und wann.</p>';
  }

  var context = getContextDetails(data);
  if (context.length > 0) {
    html += '<p><strong>Weitere Angaben zur Einordnung:</strong></p><ul>';
    context.forEach(function (detail) {
      html += '<li>' + escapeHtml(detail) + '</li>';
    });
    html += '</ul>';
  }

  html += '<p style="color:var(--text-secondary); font-size:12px;">Diese regelbasierte Orientierung ist keine Diagnose und ersetzt keine individuelle fachliche Beurteilung.</p>';
  box.innerHTML = html;
  box.style.display = 'block';
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getContextDetails(data) {
  var details = [];
  var selectedGaits = data.gangarten.map(function (gait) {
    return FORM_LABELS.gangarten[gait];
  }).filter(Boolean);

  if (data.alter) details.push('Alter: ' + data.alter + ' Jahre');
  if (data.geschlecht) details.push('Geschlecht: ' + FORM_LABELS.geschlecht[data.geschlecht]);
  if (data.rasse) details.push('Rasse: ' + data.rasse);
  if (data.ausbildungsstand) {
    details.push('Ausbildungsstand: ' + FORM_LABELS.ausbildungsstand[data.ausbildungsstand]);
  }
  if (data.ausruestung) details.push('Ausrüstung / Hilfsmittel: ' + data.ausruestung);
  if (selectedGaits.length) details.push('Beobachtet in: ' + selectedGaits.join(', '));
  if (data.konsistenz) details.push('Auftreten: ' + FORM_LABELS.konsistenz[data.konsistenz]);
  if (data.kontext) details.push('Kontext: ' + FORM_LABELS.kontext[data.kontext]);
  if (data.reaktion) details.push('Deine übliche Reaktion: ' + data.reaktion);
  if (data.ziel) details.push('Dein Trainingsziel: ' + FORM_LABELS.ziel[data.ziel]);
  return details;
}

function escapeHtml(text) {
  var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, function (character) { return map[character]; });
}
