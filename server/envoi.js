// Vigie Marchés : envoi de mails (lien « mot de passe oublié »).
// Service gratuit Brevo (300 mails par jour, API HTTP : Render gratuit bloque les ports SMTP).
// Variables Render : BREVO_API_KEY et MAIL_EXPEDITEUR (adresse validée dans Brevo).
"use strict";
const configure = () => !!(process.env.BREVO_API_KEY && process.env.MAIL_EXPEDITEUR);
async function envoyerMail({ a, sujet, html, texte }) {
  if (!configure()) throw new Error("envoi de mail non configuré");
  const r = await fetch(process.env.BREVO_URL || "https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ sender: { email: process.env.MAIL_EXPEDITEUR, name: process.env.MAIL_NOM || "Vigie Marchés" }, to: [{ email: a }], subject: sujet, htmlContent: html, textContent: texte }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("Brevo a répondu " + r.status + " " + (await r.text().catch(() => "")).slice(0, 200));
}
module.exports = { envoyerMail, mailConfigure: configure };
