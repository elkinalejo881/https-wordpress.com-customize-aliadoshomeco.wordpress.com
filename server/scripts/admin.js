// Uso (en el servidor):  node scripts/admin.js crear-lab <id> "<Nombre>" <correo-admin> <contraseña> ["Ciudad"]
//                        node scripts/admin.js listar
//                        node scripts/admin.js demo        (2 laboratorios de ejemplo para la prueba)
// Habla con el servidor en marcha usando ADMIN_KEY (así nunca se pisa el archivo de datos).
const base = process.env.API ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`, key = process.env.ADMIN_KEY;
if (!key) { console.error('Falta ADMIN_KEY en el entorno'); process.exit(1); }
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${r.status} ${j.message ?? ''}`); return j;
};
const [cmd, ...a] = process.argv.slice(2);
try {
  if (cmd === 'crear-lab') {
    const [id, name, adminEmail, adminPassword, city] = a; if (!id || !name || !adminEmail || !adminPassword) throw new Error('Uso: crear-lab <id> "<Nombre>" <correo> <contraseña> ["Ciudad"]');
    const { lab } = await call('POST', '/api/admin/labs', { id, name, adminEmail, adminPassword, city });
    console.log(`Laboratorio creado: ${lab.name}\n  Código de invitación para veterinarios: ${lab.inviteCode}\n  Acceso del laboratorio: ${adminEmail}`);
  } else if (cmd === 'listar') {
    for (const l of (await call('GET', '/api/admin/labs')).labs) console.log(`${l.id.padEnd(14)} ${l.name.padEnd(28)} código ${l.inviteCode}  veterinarios:${l.vets} solicitudes:${l.requests}`);
  } else if (cmd === 'demo') {
    for (const [id, name, email, city] of [['agrolab', 'Agrolab Diagnóstico Veterinario', 'agrolab@demo.co', 'Bogotá'], ['vetcaribe', 'VetCaribe Laboratorio', 'vetcaribe@demo.co', 'Barranquilla']])
      try { const { lab } = await call('POST', '/api/admin/labs', { id, name, adminEmail: email, adminPassword: 'Demo-12345', city }); console.log(`${name}: acceso ${email} / Demo-12345 · código ${lab.inviteCode}`); } catch (e) { console.log(`${name}: ${e.message}`); }
  } else console.log('Comandos: crear-lab | listar | demo');
} catch (e) { console.error('Error:', e.message); process.exit(1); }
