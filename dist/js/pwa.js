(function () {
  'use strict';

  const ready = 'serviceWorker' in navigator
    ? navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .catch(error => {
        console.error('Der PWA-Service-Worker konnte nicht aktiviert werden.', error);
        return null;
      })
    : Promise.resolve(null);

  function dispatch(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  function handleMessage(message) {
    if (!message || typeof message.type !== 'string') return;

    if (message.type === 'AI_REQUEST_QUEUED') {
      dispatch('equi-ai-pending', message);
    } else if (message.type === 'AI_REQUEST_COMPLETE') {
      dispatch('equi-ai-complete', message);
    } else if (message.type === 'AI_QUEUE_STATE' && Array.isArray(message.records)) {
      message.records.forEach(record => {
        dispatch(record.status === 'complete' ? 'equi-ai-complete' : 'equi-ai-pending', record);
      });
    }
  }

  const displayedRequestIds = new Set();
  window.addEventListener('equi-ai-pending', event => {
    const output = document.getElementById('chatOutput');
    const question = event.detail.question;
    if (output && question) {
      output.textContent = `Gespeicherte Anfrage wartet auf Verbindung:\n\n${question}`;
    }
  });

  window.addEventListener('equi-ai-complete', event => {
    const { id, result } = event.detail;
    const output = document.getElementById('chatOutput');
    if (!output || !result || displayedRequestIds.has(id)) return;
    displayedRequestIds.add(id);

    const answer = result.body?.answer;
    const label = document.body.classList.contains('coach-app') ? 'Profi-Coach' : 'KI-Coach';
    if (result.status >= 200 && result.status < 300 && typeof answer === 'string' && answer.trim()) {
      output.textContent = `Antwort vom ${label}:\n\n${answer}`;
    } else {
      output.textContent = `Die gespeicherte Anfrage konnte nicht beantwortet werden: ${result.body?.error || `HTTP ${result.status}`}`;
    }

    window.EquiCoachPWA.acknowledge(id).catch(error => {
      console.error('Die abgeschlossene KI-Anfrage konnte nicht aus dem Offline-Speicher entfernt werden.', error);
    });
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
      handleMessage(event.data);
    });
  }

  async function sendMessage(message, expectedResponse) {
    const registration = await ready;
    const worker = navigator.serviceWorker?.controller || registration?.active;
    if (!worker) throw new Error('Der Offline-Service-Worker ist nicht verfügbar.');

    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = window.setTimeout(() => {
        channel.port1.close();
        reject(new Error('Der Service Worker hat nicht rechtzeitig geantwortet.'));
      }, 5000);
      channel.port1.onmessage = event => {
        window.clearTimeout(timeout);
        channel.port1.close();
        handleMessage(event.data);
        resolve(event.data);
      };
      worker.postMessage(message, [channel.port2]);
      if (!expectedResponse) {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve();
      }
    });
  }

  async function refreshQueue() {
    if (navigator.onLine) {
      await sendMessage({ type: 'PROCESS_AI_QUEUE' }, 'AI_QUEUE_PROCESSED');
    }
    await sendMessage({ type: 'GET_AI_QUEUE' }, 'AI_QUEUE_STATE');
  }

  window.addEventListener('online', () => {
    refreshQueue().catch(error => console.error('Die gespeicherten KI-Anfragen konnten nicht abgefragt werden.', error));
  });

  window.addEventListener('DOMContentLoaded', () => {
    ready.then(registration => {
      if (!registration) return;
      refreshQueue().catch(error => console.error('Die gespeicherten KI-Anfragen konnten nicht abgefragt werden.', error));
    });
  });

  window.EquiCoachPWA = {
    ready,
    acknowledge(id) {
      return sendMessage({ type: 'AI_REQUEST_ACK', id });
    }
  };

  const installButton = document.querySelector('#install');
  if (installButton) {
    let installPrompt = null;
    const installedMode = window.matchMedia(
      '(display-mode: standalone), (display-mode: minimal-ui)'
    );

    function updateInstallButton() {
      const installed = installedMode.matches || navigator.standalone === true;
      if (installed) installPrompt = null;
      installButton.hidden = installed || !installPrompt;
    }

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      installPrompt = event;
      updateInstallButton();
    });

    installButton.addEventListener('click', async () => {
      if (!installPrompt) return;

      const prompt = installPrompt;
      installPrompt = null;
      updateInstallButton();
      try {
        await prompt.prompt();
      } catch (error) {
        console.error('Die App-Installation konnte nicht gestartet werden.', error);
      }
    });

    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      installButton.hidden = true;
    });
    window.addEventListener('pageshow', updateInstallButton);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) updateInstallButton();
    });
    installedMode.addEventListener('change', updateInstallButton);
    updateInstallButton();
  }
})();
