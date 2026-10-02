'use strict';

/**
 * Envoi d'e-mails.
 *
 * Fonctionne avec n'importe quel fournisseur SMTP (Brevo, Postmark, Mailjet,
 * OVH, Scaleway TEM...). Sans SMTP_HOST, les e-mails sont affichés dans la
 * console : pratique en développement, rien n'est envoyé.
 */

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const APP_NAME = process.env.APP_NAME || 'Pack Hygiène HACCP';

/** Adresse publique de l'application, utilisée dans les liens des e-mails. */
function appUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  // En production, ne jamais construire un lien à partir de l'en-tête Host
  // (un attaquant pourrait détourner les liens de réinitialisation).
  if (process.env.NODE_ENV === 'production') throw new Error('APP_URL doit être défini en production');
  return req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000';
}

/**
 * Construit un e-mail à partir de blocs simples :
 *  - string : paragraphe
 *  - { list: [...] } : liste à puces
 *  - { button: 'Libellé', url } : bouton
 *  - { title: '...' } : intertitre
 */
function compose({ subject, blocks, footer }) {
  const html = [];
  const text = [];
  for (const b of blocks) {
    if (typeof b === 'string') {
      html.push(`<p style="margin:0 0 14px">${esc(b)}</p>`);
      text.push(b, '');
    } else if (b.title) {
      html.push(`<h3 style="margin:18px 0 8px;font-size:16px;color:#0b3b37">${esc(b.title)}</h3>`);
      text.push(b.title.toUpperCase());
    } else if (b.list) {
      html.push(`<ul style="margin:0 0 14px;padding-left:20px">${b.list.map((i) => `<li style="margin-bottom:4px">${esc(i)}</li>`).join('')}</ul>`);
      text.push(...b.list.map((i) => `- ${i}`), '');
    } else if (b.button) {
      html.push(`<p style="margin:20px 0"><a href="${esc(b.url)}" style="background:#0f766e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${esc(b.button)}</a></p>`);
      text.push(`${b.button} : ${b.url}`, '');
    }
  }
  const foot = footer || `Cet e-mail vous est envoyé par ${APP_NAME}.`;
  return {
    subject,
    text: `${text.join('\n')}\n--\n${foot}\n`,
    html: `<!doctype html><html lang="fr"><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;padding:24px">
<div style="font-weight:700;color:#0f766e;margin-bottom:16px">🛡️ ${esc(APP_NAME)}</div>
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:24px;font-size:15px;line-height:1.5">
<h2 style="margin:0 0 16px;font-size:19px">${esc(subject)}</h2>${html.join('')}</div>
<p style="color:#64748b;font-size:12px;margin-top:16px">${esc(foot)}</p></div></body></html>`,
  };
}

function createMailer(env = process.env) {
  const from = env.MAIL_FROM || `${APP_NAME} <no-reply@localhost>`;
  if (!env.SMTP_HOST) {
    return {
      configured: false,
      async send({ to, subject, text }) {
        console.log(`\n[e-mail non envoyé : SMTP non configuré]\nÀ : ${[].concat(to).join(', ')}\nObjet : ${subject}\n${text}`);
      },
    };
  }
  const nodemailer = require('nodemailer');
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT) || 587,
    secure: env.SMTP_SECURE === '1' || Number(env.SMTP_PORT) === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return {
    configured: true,
    async send({ to, subject, text, html }) {
      await transport.sendMail({ from, to: [].concat(to).join(', '), subject, text, html });
    },
  };
}

/** Faux service d'envoi pour les tests : conserve les messages. */
function createMemoryMailer() {
  const outbox = [];
  return { configured: true, outbox, async send(msg) { outbox.push({ ...msg, to: [].concat(msg.to) }); } };
}

module.exports = { createMailer, createMemoryMailer, compose, appUrl, APP_NAME };
