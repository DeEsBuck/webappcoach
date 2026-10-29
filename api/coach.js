const { GoogleGenAI } = require('@google/genai');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Nur POST-Anfragen sind erlaubt.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Ungültiges JSON.' });
  }

  const question = body?.question;
  if (typeof question !== 'string' || !question.trim() || question.length > 4000) {
    return res.status(400).json({ error: 'Bitte gib eine Frage mit maximal 4000 Zeichen ein.' });
  }

  const mode = body.mode ?? 'default';
  if (mode !== 'default' && mode !== 'professional') {
    return res.status(400).json({ error: 'Ungültiger Coach-Modus.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY ist nicht konfiguriert.');
    return res.status(500).json({ error: 'Der KI-Dienst ist noch nicht konfiguriert.' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: question.trim(),
      config: {
        systemInstruction: mode === 'professional'
          ? `Du bist eine fachkundige Expertenfachkraft für die klassische Ausbildungsskala im Reitsport.
Beschränke deine Analyse ausschließlich auf Stufe 1 (Takt), Stufe 2 (Losgelassenheit) und Stufe 3 (Anlehnung). Behandle keine höheren Stufen.
Erkenne anhaltende Widersetzlichkeit oder mögliche Schmerzen und empfehle in solchen Fällen, das Training zu unterbrechen und eine spezialisierte Tierärztin oder einen spezialisierten Tierarzt hinzuzuziehen.
Zerlege Übungen in klare, strukturierte Trainingsschritte. Antworte verständlich, pferdegerecht und praxisnah. Stelle keine medizinischen Diagnosen.`
          : `Du bist ein hilfreicher und fachkundiger Reitcoach für die klassische Ausbildungsskala.
Beschränke dich auf Takt, Losgelassenheit und Anlehnung. Gib verständliche, pferdegerechte und praxisnahe Hinweise sowie konkrete Übungen in klaren Schritten.
Stelle keine medizinischen Diagnosen. Weise bei anhaltenden Schmerzen, deutlicher Lahmheit oder wiederkehrendem Widersetzungsverhalten darauf hin, Training zu unterbrechen und eine Tierärztin oder einen Tierarzt hinzuzuziehen.`
      }
    });

    const answer = response.text;
    if (typeof answer !== 'string' || !answer.trim()) {
      console.error('Google GenAI lieferte keine Antwort im erwarteten Format.');
      return res.status(502).json({ error: 'Der KI-Dienst lieferte keine gültige Antwort.' });
    }

    return res.status(200).json({ answer });
  } catch (error) {
    console.error('Google GenAI-Anfrage fehlgeschlagen:', error);
    return res.status(502).json({ error: 'Der KI-Dienst ist momentan nicht erreichbar.' });
  }
};
