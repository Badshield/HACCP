'use strict';

const { openDb } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const db = openDb();
createApp(db).listen(port, () => {
  console.log(`HACCP prêt sur http://localhost:${port}`);
});
