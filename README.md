## Kleines Sensor-Testsetup mit Android-Gerät

Die statischen Frontend-Dateien liegen in `dist/`. Lokaler Server und Vercel liefern dieses Verzeichnis als Website-Wurzel aus; API-Funktionen und Server-Skripte bleiben im Projekt-Root.

Das auszuliefernde Frontend liegt in `dist/`. Der lokale Server und Vercel verwenden dieses Verzeichnis als Webroot; die Vercel-API-Funktion bleibt unter `api/` im Repository-Root.

### 1. Node-Server auf dem PC starten
Dein Device kann die **echten Bewegungssensoren** liefern. Node muss sie nicht simulieren: Der Server stellt nur die App bereit, während Chrome auf dem Device die Sensoren ausliest.

### 1. Gemini lokal und in einer Preview testen

Der lokale Entwicklungsserver verwendet dieselbe Gemini-Funktion wie das Deployment unter `/api/coach`; er gibt keine Mock-Antwort zurück.

1. Verwende Node.js 20.6 oder neuer. Erstelle eine lokale Env-Datei und trage dort deinen Gemini-Schlüssel ein:

   ```text
   GEMINI_API_KEY=dein-Gemini-API-Schlüssel
   ```

   Du kannst `.env.example` nach `.env.local` kopieren. `.env.local` ist in Git ignoriert. Den Schlüssel niemals in Frontend-Dateien oder ein Commit schreiben.
2. Für Tests am PC ohne Android-Gerät starte den Server und lass das Terminal geöffnet:

   ```powershell
   npm.cmd run dev
   ```

   Öffne danach `http://localhost:3000/appcoach.html`. Fragen werden an Gemini gesendet und können API-Kontingent verbrauchen.
3. Für eine Vercel-Preview den Schlüssel in **Project Settings → Environment Variables** mit dem Namen `GEMINI_API_KEY` und dem Environment **Preview** hinterlegen. Wenn nur der Branch `features` den Schlüssel erhalten soll, die Preview-Branch-Einschränkung auf `features` setzen. Danach eine neue Preview-Deployment erstellen; bereits laufende Deployments übernehmen neue Variablen nicht. Schütze die Preview-URL mit Vercel Deployment Protection, damit Dritte den Gemini-Endpunkt nicht auf deine Kosten verwenden können.

Prüfe den lokalen Server bei Bedarf in einem zweiten PowerShell-Fenster:

```powershell
curl.exe -I http://127.0.0.1:3000/appcoach.html
```

Erwartet wird `HTTP/1.1 200 OK`.

### 2. Hardware-Device verbinden

#### Verbindung per USB

1. Aktiviere auf dem Device die **Entwickleroptionen** und darin **USB-Debugging**.
2. Verbinde das entsperrte Device mit einem datenfähigen USB-Kabel mit dem PC. Bestätige auf dem Device **USB-Debugging zulassen?**. Bei Bedarf wähle in der USB-Benachrichtigung **Dateiübertragung**.
3. Prüfe in PowerShell:

   ```powershell
   adb devices -l
   ```

   Das Device muss mit dem Status `device` erscheinen. Bei `unauthorized` entsperre es und bestätige die Abfrage. Wird kein Device angezeigt, prüfe Kabel, USB-Port und ob USB-Debugging aktiviert ist.

#### Kabellose Verbindung (Android 11 oder neuer)

PC und Device müssen im selben WLAN sein. Auf dem Device unter **Entwickleroptionen → Drahtloses Debugging** die Funktion aktivieren und **Gerät mit Pairing-Code koppeln** auswählen. In PowerShell die angezeigte IP-Adresse und den Pairing-Port verwenden:

```powershell
adb pair IP-ADRESSE:PAIRING-PORT
```

Den Pairing-Code eingeben. Danach in den Details von **Drahtloses Debugging** den separaten ADB-Port ablesen und verbinden:

```powershell
adb connect IP-ADRESSE:ADB-PORT
adb devices -l
```

`adb devices -l` muss das Device mit Status `device` auflisten. Wenn mehrere Geräte verbunden sind, kopiere die gewünschte Geräte-ID (meist `IP-ADRESSE:ADB-PORT`).

### 3. Server und Debug-Verbindungen starten

Im Projektordner in PowerShell:

```powershell
node launch.js
```

Bei mehreren ADB-Geräten fragt das Skript nach der Auswahl. Alternativ kannst du die Geräte-ID direkt übergeben:

```powershell
node launch.js "IP-ADRESSE:ADB-PORT"
```

Das Skript startet den lokalen Server und richtet zwei Verbindungen ein: `adb reverse` macht den Server auf dem Device unter `localhost:3000` erreichbar; `adb forward` stellt die Chrome-DevTools-Schnittstelle für VS Code unter `localhost:9222` bereit. Port 3000 muss frei sein; falls dort bereits ein Server läuft, bricht das Skript ab, bevor es ADB-Weiterleitungen ändert. Mit **Ctrl+C** werden Server und beide ADB-Weiterleitungen beendet.

### 4. App öffnen und mit vscode-js-debug verbinden

Öffne **Chrome auf dem Device** und gehe zu:

```text
http://localhost:3000/appcoach.html
```

`localhost` ist wichtig, damit der Browser den Ursprung als sicheren Kontext behandelt. Öffne in VS Code **Run and Debug**, wähle **Attach to Android Chrome (js-debug)** und starte mit **F5**. Die Konfiguration verwendet den in `launch.js` eingerichteten Debug-Port 9222; Breakpoints greifen in die Dateien dieses Workspaces.

### 5. Sensor vor dem ersten Ritt kalibrieren

### PWA-Start und Einstiegsformular

Das PWA-Manifest startet nach der Installation zunächst unter `profile.html`. Nach dem Ausfüllen wird die Einstiegsanalyse lokal gespeichert. Wenn du im Dialog **Weiter zu Equicoach** auswählst, speichert der Service Worker die abgeschlossene Übergabe in der Cache API und öffnet `appcoach.html`. Bei späteren PWA-Starts leitet der Service Worker den Manifest-Start von `profile.html` automatisch zur Haupt-App um. Der Service Worker cached die App-Dateien aus `dist/` für den Offline-Betrieb; KI-Anfragen an die Cloud werden bis zur nächsten Verbindung zwischengespeichert.

### 4. Bewegung testen
1. Wähle **Sensor befestigt an** und befestige das Device für alle Vergleichsmessungen an derselben Stelle.
2. Öffne **Sensordaten vor dem ersten Ritt kalibrieren** und wähle die Gangart, die während der Messung tatsächlich geritten wird.
3. Nimm für Schritt, Trab und Galopp jeweils bis zu drei separate 10-Sekunden-Messungen auf. Die App zeigt pro Aufnahme die lokale Rhythmus-Schätzung und die ausgewählte Gangart zum Vergleich. Bei drei vorhandenen Aufnahmen ersetzt eine neue die älteste für diese Gangart und Sensorposition.
4. Wiederhole die Messungen bei einer anderen Befestigungsposition separat über die Auswahl **Sensor befestigt an**. Die Daten bleiben im lokalen Browserprofil und können für die ausgewählte Position gelöscht werden.

Starte die Aufnahme erst, wenn die Gangart sicher und gleichmäßig ausgeführt wird. Bediene das Device nicht während des Reitens; lasse es fest befestigt und eine andere Person die Aufnahme steuern. Die Rhythmus-/Gangart-Ausgabe ist experimentell und keine validierte Erkennung. Es werden keine Rohdaten oder Kalibrierungsdaten an den KI-Coach gesendet.

### 6. Bewegung testen

1. Tippe auf **Ritt starten**.
2. Erlaube den Sensorzugriff, falls Chrome danach fragt.
3. Bewege das Device vorsichtig und beobachte den Status im Tracking-Bereich.
4. Tippe auf **Ritt beenden**.

Nach mindestens zwei verwertbaren Messungen für jede Gangart kannst du die Kalibrierung ausdrücklich bestätigen. Nur dann wird bei einem Ritt mit derselben Sensorposition die automatische Gangartwahl aktiviert. Sie wechselt erst nach drei aufeinanderfolgenden stabilen Rhythmusschätzungen; bei unsicheren Signalen bleibt die aktuelle Auswahl bestehen. **Pause** bleibt manuell und setzt die automatische Wahl aus, bis du wieder eine aktive Gangart auswählst.

Zur Bestätigung darf sich jedes Paar der Rhythmusbereiche höchstens um 10% überschneiden. Der Überlappungsgrad wird als Schnittmenge geteilt durch Vereinigungsbereich der BPM-Intervalle (IoU) berechnet; genau 10% ist zulässig.

Mit der bestätigten Kalibrierung vergleicht die lokale Analyse die Streuung der Bewegungsintervalle und die Beschleunigungsdynamik erkannter Rhythmusfenster mit den Referenzmessungen derselben Gangart. Ein Fenster gilt als auffällig, wenn die Intervallstreuung über dem Kalibrierungsmedian um mindestens 8 Prozentpunkte oder 50 Prozent des Basiswerts liegt. Beschleunigungsdynamik ab dem 1,25-Fachen der Referenz wird als möglicher Schwunghinweis dargestellt. Das sind experimentelle, positionsabhängige Sensorindikatoren und keine validierte Bewertung von Takt oder Schwung. Es werden nur zusammengefasste Kennwerte pro Gangart gespeichert, keine Ritt-Rohmessungen.

Ein begrenzter Ringpuffer mit den jüngsten Rohmesswerten bleibt im Arbeitsspeicher des Browsers und wird weder dauerhaft gespeichert noch an den KI-Coach übertragen. Die Sensorwerte liefern weiterhin heuristisch erkannte Schrittimpulse, keine validierte Pferdeschrittzählung.

Im Tab **Analyse** werden die Bewertungen für Takt- und Schwunggefühl der letzten Ritte gemeinsam mit den erfassten Gangartenanteilen visualisiert. Die Bewertung ist eine Selbsteinschätzung; die Grafik zeigt keinen ursächlichen Zusammenhang zwischen Bewertung und Gangartenverteilung.

### 7. Optional: Browser-Konsole am PC ansehen

Für die Fehlersuche verbinde das Device per USB und öffne am PC Chrome:

```text
chrome://inspect/#devices
```

Aktiviere die USB-Geräteerkennung und klicke beim geöffneten Device-Tab auf **Inspect**. Dort siehst du JavaScript-Fehler und `console`-Meldungen.

### Wenn es nicht klappt

- **`ERR_CONNECTION_REFUSED` auf dem Device:** Prüfe den `curl`-Test am PC und wiederhole `adb reverse` mit der richtigen Geräte-ID.
- **VS Code findet keinen Chrome-Tab:** Chrome auf dem Device öffnen und die URL laden, dann `node launch.js` laufen lassen und in Run and Debug **Attach to Android Chrome (js-debug)** wählen. Die Geräteverbindung muss in `adb devices -l` den Status `device` haben.
- **Sensor nicht verfügbar:** Prüfe, ob du die Seite wirklich in Chrome auf dem Device geöffnet hast, und starte den Ritt erneut.
- **ADB-Weiterleitungen prüfen oder zurücksetzen:**
  ```powershell
  adb -s "GERÄTE-ID" forward --list
  adb -s "GERÄTE-ID" reverse --list
  adb -s "GERÄTE-ID" forward --remove tcp:9222
  adb -s "GERÄTE-ID" reverse --remove tcp:3000
  ```

### Daten für den KI-Coach in `appcoach.html`

Beim Senden einer Frage sammelt `metadata.js` die letzte Einstiegsformular-Analyse, eine Zusammenfassung des letzten Ritts, bis zu fünf aktuelle Tagebucheinträge und bis zu sieben Plan-Einträge. Leere Trainingstage werden ausgelassen. Diese begrenzten Daten werden zusammen mit der Frage an `/api/coach` übertragen und dort erneut geprüft, bevor sie als unbestätigter Kontext an den KI-Dienst gehen. Nicht vorhandene Datenbereiche bleiben leer.
