## Kleines Sensor-Testsetup mit Android-Gerät

Dein Pixel kann die **echten Bewegungssensoren** liefern. Node muss sie nicht simulieren: Der Server stellt nur die App bereit, während Chrome auf dem Pixel die Sensoren ausliest.

### 1. Node-Server auf dem PC starten

Starte den lokalen Server wie bisher auf **Port 3000** und lass das Terminal geöffnet. Prüfe auf dem PC in einem zweiten PowerShell-Fenster:

```powershell
curl.exe -I http://127.0.0.1:3000/appcoach.html
```

```bash
npm run dev
```

Erwartet wird `HTTP/1.1 200 OK`.

### 2. Pixel verbinden und Port weiterleiten

Aktiviere auf dem Pixel **Entwickleroptionen** und **USB-Debugging**, verbinde es per USB und bestätige die Debugging-Abfrage.

Zeige die ADB-Geräte an:

```powershell
adb devices -l
```

Wenn das Pixel mehrfach erscheint, verwende für die Weiterleitung genau eine Geräte-ID aus der Ausgabe:

```powershell
adb -s "GERÄTE-ID" reverse tcp:3000 tcp:3000
adb -s "GERÄTE-ID" reverse --list
```

Ersetze `GERÄTE-ID` exakt durch die angezeigte Seriennummer. Deine frühere Ausgabe zeigte zwei Verbindungen zum Pixel; das ist der Grund für `more than one device/emulator`.

### 3. App auf dem Pixel öffnen

Öffne **Chrome auf dem Pixel** und gehe zu:

```text
http://localhost:3000/appcoach.html
```

Durch `adb reverse` wird dieser Aufruf vom Pixel an den Server auf deinem PC weitergeleitet. `localhost` ist außerdem wichtig, damit der Browser den Ursprung als sicheren Kontext behandeln kann.

### 4. Bewegung testen

1. Tippe auf **Ritt starten**.
2. Erlaube den Sensorzugriff, falls Chrome danach fragt.
3. Bewege das Pixel vorsichtig und beobachte den Status im Tracking-Bereich.
4. Tippe auf **Ritt beenden**.

Die Gangart wird weiterhin manuell über die Tasten gewählt. Die Sensorwerte liefern zusätzlich heuristisch erkannte Schrittimpulse, die der aktuell ausgewählten Gangart zugeordnet werden. Das ist weder eine automatische Gangarterkennung noch eine validierte Pferdeschritt- oder Taktbewertung.

### 5. Optional: Browser-Konsole am PC ansehen

Für die Fehlersuche verbinde das Pixel per USB und öffne am PC Chrome:

```text
chrome://inspect/#devices
```

Aktiviere die USB-Geräteerkennung und klicke beim geöffneten Pixel-Tab auf **Inspect**. Dort siehst du JavaScript-Fehler und `console`-Meldungen.

### Wenn es nicht klappt

- **`ERR_CONNECTION_REFUSED` auf dem Pixel:** Prüfe den `curl`-Test am PC und wiederhole `adb reverse` mit der richtigen Geräte-ID.
- **Sensor nicht verfügbar:** Prüfe, ob du die Seite wirklich in Chrome auf dem Pixel geöffnet hast, und starte den Ritt erneut.
- **Weiterleitung zurücksetzen:**  
  ```powershell
  adb -s "GERÄTE-ID" reverse --remove tcp:3000
  adb -s "GERÄTE-ID" reverse tcp:3000 tcp:3000
  ```

### Schrittimpulse und Sensordebugging

Vor dem Start der Erfassung den Befestigungsort wählen und das Gerät dort fest anbringen. Die Auswahl „Pferd / Sattel“ verwendet momentan einen empfindlicheren, heuristischen Schwellwert als „Reiter“ oder „Anderer Ort“; diese Profile sind nicht wissenschaftlich kalibriert. Die angezeigten Schrittzahlen sind erkannte Beschleunigungsimpulse je manuell ausgewählter Gangart und keine validierte Pferdeschrittzählung.

Für Messwerte in den Chrome DevTools „Sensordaten in Chrome DevTools protokollieren“ aktivieren, den Ritt starten und in `chrome://inspect/#devices` den Tab des Pixels untersuchen. In der Console nach `[EquiCoach Sensor]` filtern. Die Messwertobjekte enthalten Quelle, Befestigungsort, ausgewählte Gangart, Beschleunigungsachsen, Signalstärke, Schwellwert, Bewegungsstatus und Zählerstände. Ohne aktiviertes Debug-Logging erscheinen nur Verbindungs-, Schrittimpuls- und Sitzungszusammenfassungen.