const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const readline = require('node:readline/promises');

const root = __dirname;
const port = 3000;
const adbCommand = process.platform === 'win32' ? 'adb.exe' : 'adb';

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
    console.log('Startet den lokalen Server und richtet adb reverse für Port 3000 ein.');
    return;
  }

  const requestedSerial = process.argv[2];
  if (process.argv.length > 3) {
    throw new Error('Verwendung: node launch.js [ADB-GERÄTE-ID]');
  }
  if (!fs.existsSync(path.join(root, '.env.local'))) {
    throw new Error('`.env.local` fehlt. Erstelle sie mit `Copy-Item .env.example .env.local` und trage deinen Gemini-Schlüssel ein.');
  }

  const devicesOutput = runAdb(['devices', '-l']);
  const entries = parseDevices(devicesOutput);
  const devices = entries.filter(entry => entry.state === 'device').map(entry => entry.serial);
  if (devices.length === 0) {
    const status = entries.length
      ? entries.map(entry => `  ${entry.serial}: ${entry.state}`).join('\n')
      : '  ADB listet kein verbundenes Gerät auf.';
    throw new Error(
      `Kein autorisiertes ADB-Gerät gefunden.\n${status}\n` +
      'Prüfe USB-Kabel und USB-Debugging. Bei "unauthorized": Gerät entsperren und die USB-Debugging-Abfrage bestätigen. ' +
      'Erst wenn `adb devices -l` den Status "device" zeigt, erneut `node launch.js` starten.'
    );
  }
  const serial = await chooseDevice(devices, requestedSerial);

  runAdb(['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  console.log(`ADB-Weiterleitung eingerichtet: ${serial} → Port ${port}`);
  console.log(`Starte Server unter http://localhost:${port}/appcoach.html (mit Ctrl+C beenden).`);

  let stopping = false;
  let reverseActive = true;
  let serverProcess;
  const removeReverse = () => {
    if (!reverseActive) return;
    reverseActive = false;
    runAdb(['-s', serial, 'reverse', '--remove', `tcp:${port}`], { stdio: 'ignore' });
  };
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    try {
      removeReverse();
    } catch (error) {
      console.error(`ADB-Weiterleitung konnte nicht entfernt werden: ${error.message}`);
    }
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
    try {
      removeReverse();
    } catch (cleanupError) {
      console.error(`ADB-Weiterleitung konnte nicht entfernt werden: ${cleanupError.message}`);
    }
    process.exitCode = 1;
  });
  serverProcess.once('exit', (code, signal) => {
    try {
      removeReverse();
    } catch (error) {
      console.error(`ADB-Weiterleitung konnte nicht entfernt werden: ${error.message}`);
    }
    if (!stopping) process.exitCode = signal ? 1 : (code ?? 1);
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
