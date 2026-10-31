(function (global) {
  const ENTRY_ANALYSIS_KEY = 'equi_entry_analysis';
  const STAGES = ['takt', 'losgelassenheit', 'anlehnung'];
  const SIGNALS = [
    'takt:eilt',
    'takt:hektisch',
    'takt:unregelmaessig',
    'losgelassenheit:verspannt',
    'losgelassenheit:ruecken',
    'losgelassenheit:kopf',
    'anlehnung:gegenhand',
    'anlehnung:kopf',
    'anlehnung:verbindung'
  ];
  const GAITS = ['schritt', 'trab', 'galopp'];
  const LABELS = {
    sex: ['stute', 'wallach', 'hengst'],
    trainingLevel: ['jungpferd', 'fortgeschritten', 'turnier'],
    frequency: ['immer', 'manchmal', 'situativ'],
    context: ['nur_sattel', 'auch_boden'],
    goal: ['sicherheit', 'ruhe', 'basis']
  };

  function text(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function allowedValue(value, allowed) {
    return allowed.includes(value) ? value : '';
  }

  function allowedValues(value, allowed) {
    return Array.isArray(value) ? value.filter((item) => allowed.includes(item)) : [];
  }

  function normalizeEntryAnalysis(data, diagnosis, analyzedAt) {
    const matched = {};
    STAGES.forEach((stage) => {
      matched[stage] = Array.isArray(diagnosis.matched?.[stage])
        ? diagnosis.matched[stage].filter((item) => typeof item === 'string').map((item) => item.slice(0, 100)).slice(0, 20)
        : [];
    });

    const age = Number(data.alter);
    return {
      analyzedAt: text(analyzedAt, 40),
      horse: {
        name: text(data.name, 100),
        age: data.alter && Number.isFinite(age) && age >= 0 ? age : null,
        sex: allowedValue(data.geschlecht, LABELS.sex),
        breed: text(data.rasse, 100),
        equipment: text(data.ausruestung, 200),
        trainingLevel: allowedValue(data.ausbildungsstand, LABELS.trainingLevel)
      },
      observation: {
        description: text(data.symptom, 1000),
        selectedSignals: allowedValues(data.selectedSignals, SIGNALS),
        gaits: allowedValues(data.gangarten, GAITS),
        frequency: allowedValue(data.konsistenz, LABELS.frequency),
        context: allowedValue(data.kontext, LABELS.context),
        healthChecked: diagnosis.healthChecked === true,
        riderResponse: text(data.reaktion, 300),
        goal: allowedValue(data.ziel, LABELS.goal)
      },
      assessment: {
        kind: 'rule-based orientation, not a diagnosis',
        focusStage: STAGES.includes(diagnosis.stage) ? diagnosis.stage : null,
        candidateStages: allowedValues(diagnosis.candidates, STAGES),
        score: Number.isFinite(diagnosis.score) ? diagnosis.score : 0,
        matched,
        suggestedExercises: Array.isArray(diagnosis.exercises)
          ? diagnosis.exercises.filter((item) => typeof item === 'string').map((item) => item.slice(0, 300)).slice(0, 10)
          : []
      }
    };
  }

  function saveEntryAnalysis(data, diagnosis) {
    if (!data || typeof data !== 'object' || !diagnosis || typeof diagnosis !== 'object') {
      throw new Error('Die Einstiegsanalyse hat ein ungültiges Format.');
    }

    const analysis = normalizeEntryAnalysis(data, diagnosis, new Date().toISOString());
    localStorage.setItem(ENTRY_ANALYSIS_KEY, JSON.stringify(analysis));
  }

  function collectEntryAnalysis() {
    const saved = readStoredJson(ENTRY_ANALYSIS_KEY, null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;

    const horse = saved.horse;
    const observation = saved.observation;
    const assessment = saved.assessment;
    if (
      !horse || typeof horse !== 'object'
      || !observation || typeof observation !== 'object'
      || !assessment || typeof assessment !== 'object'
    ) {
      return null;
    }

    return normalizeEntryAnalysis(
      {
        name: horse.name,
        alter: horse.age,
        geschlecht: horse.sex,
        rasse: horse.breed,
        ausruestung: horse.equipment,
        ausbildungsstand: horse.trainingLevel,
        symptom: observation.description,
        selectedSignals: observation.selectedSignals,
        gangarten: observation.gaits,
        konsistenz: observation.frequency,
        kontext: observation.context,
        reaktion: observation.riderResponse,
        ziel: observation.goal
      },
      {
        stage: assessment.focusStage,
        candidates: assessment.candidateStages,
        score: assessment.score,
        matched: assessment.matched,
        exercises: assessment.suggestedExercises,
        healthChecked: observation.healthChecked
      },
      saved.analyzedAt
    );
  }

  function readStoredJson(key, fallback) {
    try {
      const storedValue = localStorage.getItem(key);
      return storedValue ? JSON.parse(storedValue) : fallback;
    } catch (error) {
      console.warn(`Trainingsdaten "${key}" konnten nicht gelesen werden.`, error);
      return fallback;
    }
  }

  function normalizeStepCounts(counts) {
    if (!counts || typeof counts !== 'object') return null;
    return ['walk', 'trot', 'canter'].reduce((result, gait) => {
      result[gait] = Number.isSafeInteger(counts[gait]) && counts[gait] >= 0
        ? counts[gait]
        : 0;
      return result;
    }, {});
  }

  function normalizeTrainingEntry(entry) {
    const rating = Number(entry.rating);
    return {
      date: text(entry.date, 80),
      duration: text(entry.duration, 20),
      walkMinutes: normalizeMinutes(entry.walk),
      trotMinutes: normalizeMinutes(entry.trot),
      canterMinutes: normalizeMinutes(entry.canter),
      stepImpulseEstimate: normalizeStepCounts(entry.stepCounts),
      sensorMount: ['saddle', 'rider', 'other'].includes(entry.sensorMount) ? entry.sensorMount : null,
      rhythmRating: Number.isInteger(rating) && rating >= 1 && rating <= 6 ? rating : null,
      notes: text(entry.note, 500)
    };
  }

  function normalizeMinutes(value) {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 1440) : 0;
  }

  function summarizeLatestRide(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const training = normalizeTrainingEntry(entry);
    const totalMinutes = training.walkMinutes + training.trotMinutes + training.canterMinutes;
    const gaitPercentages = totalMinutes > 0
      ? {
        walk: Math.round(training.walkMinutes / totalMinutes * 100),
        trot: Math.round(training.trotMinutes / totalMinutes * 100),
        canter: Math.round(training.canterMinutes / totalMinutes * 100)
      }
      : { walk: 0, trot: 0, canter: 0 };

    return {
      date: training.date,
      duration: training.duration,
      gaitMinutes: {
        walk: training.walkMinutes,
        trot: training.trotMinutes,
        canter: training.canterMinutes
      },
      gaitPercentages,
      rhythmRating: training.rhythmRating,
      notes: training.notes,
      stepImpulseEstimate: training.stepImpulseEstimate,
      sensorMount: training.sensorMount
    };
  }

  function collectTrainingMetadata() {
    const history = readStoredJson('equi_history', []);
    const plan = readStoredJson('equi_plan', []);

    return {
      schemaVersion: 3,
      latestEntryAnalysis: collectEntryAnalysis(),
      latestRideAnalysis: Array.isArray(history) ? summarizeLatestRide(history[0]) : null,
      recentTraining: Array.isArray(history)
        ? history.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
          .slice(0, 5).map(normalizeTrainingEntry)
        : [],
      weeklyPlan: Array.isArray(plan)
        ? plan.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 7).map((item) => ({
          training: text(item.text, 200),
          completed: item.done === true
        })).filter((item) => item.training)
        : []
    };
  }

  global.equiMetadata = {
    collectTrainingMetadata,
    collectEntryAnalysis,
    saveEntryAnalysis
  };
})(window);