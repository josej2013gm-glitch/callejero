#!/usr/bin/env node
// Publicación desde el ordenador: inserta tu correo (VITE_OWNER_EMAIL de .env.local) en una copia
// temporal de firestore.rules y ejecuta firebase deploy. El archivo del repositorio no se modifica.
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const owner = (process.env.VITE_OWNER_EMAIL || (env.match(/^VITE_OWNER_EMAIL=(.*)$/m) || [])[1] || '').trim().toLowerCase();
if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(owner)) { console.error('Indica tu correo en VITE_OWNER_EMAIL (.env.local).'); process.exit(1); }
const rules = readFileSync('firestore.rules', 'utf8').replaceAll('__OWNER_EMAIL__', owner);
writeFileSync('firestore.deploy.rules', rules);
const cfg = JSON.parse(readFileSync('firebase.json', 'utf8'));
cfg.firestore.rules = 'firestore.deploy.rules';
writeFileSync('firebase.deploy.json', JSON.stringify(cfg, null, 2));
try {
  execFileSync('firebase', ['deploy', '--only', 'hosting,firestore:rules', '--config', 'firebase.deploy.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
} finally { rmSync('firestore.deploy.rules', { force: true }); rmSync('firebase.deploy.json', { force: true }); }
