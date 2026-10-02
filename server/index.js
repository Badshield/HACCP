'use strict';

const { openDb } = require('./db');
const { createApp } = require('./app');
const { startScheduler } = require('./reminders');

const port = Number(process.env.PORT) || 3000;
const db = openDb();
const app = createApp(db);
if (!app.locals.mailer.configured) console.warn('SMTP non configuré : les e-mails seront affichés dans la console.');
if (process.env.NODE_ENV === 'production' && !process.env.APP_URL) {
  console.warn('APP_URL non défini : les liens des e-mails (mot de passe oublié, rappels) ne fonctionneront pas.');
}
startScheduler(app.locals.reminders);
app.listen(port, () => {
  console.log(`HACCP prêt sur http://localhost:${port}`);
});
