// Acceso a GitHub con fetch nativo. El token vive solo como variable de
// entorno en Netlify y nunca llega al navegador.

const cfg = require('./config');
const { HttpError } = require('./http');

const API = 'https://api.github.com';

function headers(extra) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new HttpError(500, 'Falta la variable GITHUB_TOKEN en Netlify');
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'finite-cms',
    ...(extra || {}),
  };
}

async function gh(path, options = {}) {
  const res = await fetch(`${API}${path}`, { ...options, headers: headers(options.headers) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) throw new HttpError(500, 'GitHub rechazó el token. Revisa GITHUB_TOKEN en Netlify.');
    if (res.status === 403 || res.status === 404) {
      throw new HttpError(500, `GitHub respondió ${res.status}. Revisa que el token tenga permiso de escritura sobre ${cfg.owner}/${cfg.repo}.`);
    }
    throw new HttpError(500, `GitHub respondió ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

const repoPath = `/repos/${cfg.owner}/${cfg.repo}`;
const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

// SHA del último commit de la rama. Los archivos se leen en ese mismo commit
// y el commit nuevo cuelga de él, así lo que se lee y lo que se escribe es coherente.
async function getHead() {
  const ref = await gh(`${repoPath}/git/ref/heads/${cfg.branch}`);
  return ref.object.sha;
}

// Devuelve el texto del archivo, o null si no existe.
async function getFile(path, ref) {
  const res = await fetch(`${API}${repoPath}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref || cfg.branch)}`, {
    headers: headers({ Accept: 'application/vnd.github.raw+json' }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(500, `No se pudo leer ${path} (GitHub ${res.status})`);
  return res.text();
}

// Rutas de todos los archivos del repositorio en el commit dado.
async function listFiles(sha) {
  const c = await gh(`${repoPath}/git/commits/${sha}`);
  const t = await gh(`${repoPath}/git/trees/${c.tree.sha}?recursive=1`);
  return (t.tree || []).filter((e) => e.type === 'blob').map((e) => e.path);
}

// Un solo commit con varios archivos y borrados. Netlify despliega una vez.
async function commit({ files = [], deletes = [] }, message, baseSha) {
  const base = await gh(`${repoPath}/git/commits/${baseSha}`);
  const tree = [
    ...files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })),
    ...deletes.map((p) => ({ path: p, mode: '100644', type: 'blob', sha: null })),
  ];
  const newTree = await gh(`${repoPath}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: base.tree.sha, tree }),
  });
  const newCommit = await gh(`${repoPath}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: newTree.sha, parents: [baseSha] }),
  });
  try {
    await gh(`${repoPath}/git/refs/heads/${cfg.branch}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: newCommit.sha }),
    });
  } catch (e) {
    throw new HttpError(409, 'El sitio cambió mientras guardabas (otro commit entró primero). Vuelve a intentarlo.');
  }
  return { commitSha: newCommit.sha, commitUrl: newCommit.html_url };
}

module.exports = { getHead, getFile, commit, listFiles };
