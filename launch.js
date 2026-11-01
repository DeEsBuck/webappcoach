const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');

const root = __dirname;
const port = 3000;
const debugPort = 9222;
const adbCommand = process.platform === 'win32' ? 'adb.exe' : 'adb';

function ensureServerPortAvailable() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} wird bereits verwendet. Beende den anderen lokalen Server und starte launch.js erneut.`));
        return;
      }
      reject(error);
    });
    probe.listen(port, '127.0.0.1', () => {
      probe.close(error => error ? reject(error) : resolve());
    });
  });
}

function runAdb(args, options = {}) {
  const result = spawnSync(adbCommand, args, {
    cwd: root,
    encoding: 'utf8',
    ...options
  });

  if (result.error) {
    throw new Error(`ADB konnte nicht gestartet werden. Prüfe, ob adb installiert und im PATH ist. ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error((result.stderr || `ADB wurde mit Status ${result.status} beendet.`).trim());
  }

  return result.stdout || '';
}

function parseDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map(line => line.trim().split(/\s+/))
    .filter(parts => parts.length > 1)
    .map(parts => ({ serial: parts[0], state: parts[1] }));
}

async function chooseDevice(devices, requestedSerial) {
  if (requestedSerial) {
    if (!devices.includes(requestedSerial)) {
      throw new Error(`Das ADB-Gerät "${requestedSerial}" ist nicht verbunden oder nicht autorisiert.`);
    }
    return requestedSerial;
  }

  if (devices.length === 1) return devices[0];
  if (devices.length === 0) {
    throw new Error('Kein autorisiertes ADB-Gerät gefunden. Verbinde dein Android-Gerät und bestätige die USB-Debugging-Abfrage.');
  }
  if (!process.stdin.isTTY) {
    throw new Error(`Mehrere ADB-Geräte gefunden. Starte das Skript mit einer Geräte-ID: node launch.js "${devices[0]}"`);
  }

  console.log('Mehrere ADB-Geräte gefunden:');
  devices.forEach((serial, index) => console.log(`  ${index + 1}) ${serial}`));

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question('Gerätenummer auswählen: ');
    const selection = Number(answer);
    if (!Number.isInteger(selection) || selection < 1 || selection > devices.length) {
      throw new Error('Ungültige Auswahl.');
    }
    return devices[selection - 1];
  } finally {
    prompt.close();
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Verwendung: node launch.js [ADB-GERÄTE-ID]');
    console.log('Startet den lokalen Server und richtet App- und Chrome-Debugger-Weiterleitungen ein.');
    return;
  }

  const requestedSerial = process.argv[2];
  if (process.argv.length > 3) {
    throw new Error('Verwendung: node launch.js [ADB-GERÄTE-ID]');
  }
  if (!fs.existsSync(path.join(root, '.env.local'))) {
    throw new Error('`.env.local` fehlt. Erstelle sie mit `Copy-Item .env.example .env.local` und trage deinen Gemini-Schlüssel ein.');
  }
  await ensureServerPortAvailable();

  const devicesOutput = runAdb(['devices', '-l']);
  const entries = parseDevices(devicesOutput);
  const devices = entries.filter(entry => entry.state === 'device').map(entry => entry.serial);
  if (devices.length === 0) {
    const status = entries.length
      ? entries.map(entry => `  ${entry.serial}: ${entry.state}`).join('\n')
      : '  ADB listet kein verbundenes Gerät auf.';
    throw new Error(
      `Kein autorisiertes ADB-Gerät gefunden.\n${status}\n` +
      'Prüfe USB-Debugging. Bei "unauthorized": Gerät entsperren und die USB-Debugging-Abfrage bestätigen. ' +
      'Für WLAN zuerst mit `adb pair IP:PAIRING-PORT` koppeln und danach mit `adb connect IP:ADB-PORT` verbinden. ' +
      'Erst wenn `adb devices -l` den Status "device" zeigt, erneut `node launch.js` starten.'
    );
  }
  const serial = await chooseDevice(devices, requestedSerial);

  let reverseActive = false;
  let forwardActive = false;
  const removeForwardings = () => {
    if (forwardActive) {
      try {
        runAdb(['-s', serial, 'forward', '--remove', `tcp:${debugPort}`], { stdio: 'ignore' });
        forwardActive = false;
      } catch (error) {
        console.error(`ADB-Debugger-Weiterleitung konnte nicht entfernt werden: ${error.message}`);
      }
    }
    if (reverseActive) {
      try {
        runAdb(['-s', serial, 'reverse', '--remove', `tcp:${port}`], { stdio: 'ignore' });
        reverseActive = false;
      } catch (error) {
        console.error(`ADB-App-Weiterleitung konnte nicht entfernt werden: ${error.message}`);
      }
    }
  };

  try {
    runAdb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
    reverseActive = true;
    runAdb(['-s', serial, 'forward', `tcp:${debugPort}`, 'localabstract:chrome_devtools_remote']);
    forwardActive = true;
  } catch (error) {
    removeForwardings();
    throw error;
  }

  console.log(`ADB-App-Weiterleitung eingerichtet: ${serial} → Port ${port}`);
  console.log(`Chrome-DevTools-Weiterleitung eingerichtet: localhost:${debugPort}`);
  console.log(`Starte Server unter http://localhost:${port}/appcoach.html (mit Ctrl+C beenden).`);

  let stopping = false;
  let serverProcess;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    removeForwardings();
    if (serverProcess && serverProcess.exitCode === null) {
      serverProcess.kill();
    }
    process.exitCode = signal === 'SIGINT' ? 130 : 143;
  };

  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));

  serverProcess = spawn(
    process.execPath,
    ['--env-file=.env.local', 'dev-server.cjs'],
    { cwd: root, stdio: 'inherit' }
  );
  serverProcess.once('error', error => {
    console.error(`Der lokale Server konnte nicht gestartet werden: ${error.message}`);
    removeForwardings();
    process.exitCode = 1;
  });
  serverProcess.once('exit', (code, signal) => {
    removeForwardings();
    if (!stopping) process.exitCode = signal ? 1 : (code ?? 1);
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
