/**
 * books.js
 * - Stores books in KV (STORIES)
 * - Session creation endpoint /api/session (server checks SECRET_TOKEN)
 * - Upload cover to R2 via /api/upload-cover (requires X-SESSION)
 * - Serve R2 object via GET /r2/:key
 * - Publish book/chapter via /api/books (requires X-SESSION)
 *
 * Bindings:
 * - env.STORIES (Workers KV)
 * - env.SESSIONS (Workers KV for sessions)
 * - env.COVERS (R2 binding)
 * - env.SECRET_TOKEN (Pages env var)
 */

const SESSION_TTL_MS = 20 * 60 * 1000; // 20 minutes

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  async function readJson(req){
    try{ return await req.json() } catch(e){ return null }
  }

  // HEALTH / root
  if (request.method === 'GET' && path === '/') {
    return new Response('OK');
  }

  // CREATE SESSION (client sends auth password once)
  // POST /api/session { password }
  if (request.method === 'POST' && path === '/api/session') {
    const payload = await readJson(request);
    const password = payload && payload.password;
    if (!password) return new Response(JSON.stringify({ error: 'Missing password' }), { status: 400, headers: { 'content-type': 'application/json' } });

    if (password !== env.SECRET_TOKEN) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }

    // create session token and store in SESSIONS KV
    const token = crypto.randomUUID();
    const expires = Date.now() + SESSION_TTL_MS;
    const rec = { token, expires };
    await env.SESSIONS.put('session:' + token, JSON.stringify(rec), { expiration: Math.floor(expires / 1000) });
    return new Response(JSON.stringify({ token, expires }), { status: 201, headers: { 'content-type': 'application/json' } });
  }

  // Middleware: verify X-SESSION header maps to a valid session in KV
  async function verifySession(req) {
    const sess = req.headers.get('X-SESSION') || '';
    if (!sess) return false;
    const raw = await env.SESSIONS.get('session:' + sess);
    if (!raw) return false;
    try {
      const obj = JSON.parse(raw);
      if (Date.now() > obj.expires) {
        // expired => delete
        await env.SESSIONS.delete('session:' + sess);
        return false;
      }
      return true;
    } catch (e) { return false; }
  }

  // UPLOAD COVER to R2
  // POST /api/upload-cover { filename, data }  (data = base64 string)
  if (request.method === 'POST' && path === '/api/upload-cover') {
    if (!(await verifySession(request))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
    const payload = await readJson(request);
    if (!payload || !payload.data || !payload.filename) return new Response(JSON.stringify({ error: 'Missing' }), { status: 400, headers: { 'content-type': 'application/json' } });

    const key = `covers/${crypto.randomUUID()}-${payload.filename.replace(/[^a-zA-Z0-9-_.]/g, '_')}`;
    // decode base64
    const matches = payload.data.match(/^data:(.+);base64,(.*)$/);
    let contentType = 'application/octet-stream';
    let b64 = payload.data;
    if (matches) { contentType = matches[1]; b64 = matches[2]; }
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    // Put to R2
    await env.COVERS.put(key, bytes, { httpMetadata: { contentType } });
    // Return public path to be served via /r2/:key
    return new Response(JSON.stringify({ key, url: `${url.origin}/r2/${encodeURIComponent(key)}` }), { status: 201, headers: { 'content-type': 'application/json' } });
  }

  // Serve R2 object
  // GET /r2/:key
  if (request.method === 'GET' && path.startsWith('/r2/')) {
    const key = decodeURIComponent(path.slice(4));
    try {
      const obj = await env.COVERS.get(key);
      if (obj === null) return new Response('Not found', { status: 404 });
      // R2 returns ArrayBuffer; create Response and set content-type if possible
      const meta = await env.COVERS.head(key);
      const headers = {};
      if (meta && meta.httpMetadata && meta.httpMetadata.contentType) headers['content-type'] = meta.httpMetadata.contentType;
      return new Response(obj.body || obj, { headers });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  }

  // LIST BOOKS
  if (request.method === 'GET' && path === '/api/books') {
    const list = await env.STORIES.list({ prefix: 'book:' });
    const books = [];
    for (const k of list.keys) {
      const raw = await env.STORIES.get(k.name);
      if (!raw) continue;
      try {
        const b = JSON.parse(raw);
        books.push({
          id: b.id, title: b.title, description: b.description, cover: b.cover, chapterCount: b.chapters?.length || 0, updated_at: b.updated_at
        });
      } catch (e) {}
    }
    books.sort((a,b) => (b.updated_at||'').localeCompare(a.updated_at||''));
    return new Response(JSON.stringify(books), { headers: { 'content-type': 'application/json' } });
  }

  // GET single book
  if (request.method === 'GET' && path.startsWith('/api/books/')) {
    const id = path.split('/').pop();
    const raw = await env.STORIES.get('book:' + id);
    if (!raw) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(raw, { headers: { 'content-type': 'application/json' } });
  }

  // Publish (create/update book and append chapter) - requires X-SESSION
  if (request.method === 'POST' && path === '/api/books') {
    if (!(await verifySession(request))) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });

    const payload = await readJson(request);
    if (!payload) return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'content-type': 'application/json' } });

    if (!payload.bookTitle || !payload.chapterTitle || !payload.body) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }

    const bookId = payload.bookId || crypto.randomUUID();
    const now = new Date().toISOString();
    let bookRaw = await env.STORIES.get('book:' + bookId);
    let book = null;
    if (bookRaw) {
      try { book = JSON.parse(bookRaw); } catch(e) { book = null; }
    }

    if (!book) {
      book = { id: bookId, title: payload.bookTitle, description: payload.bookDesc || '', cover: payload.cover || '', created_at: now, updated_at: now, chapters: [] };
    } else {
      if (payload.bookTitle) book.title = payload.bookTitle;
      if (payload.bookDesc !== undefined) book.description = payload.bookDesc;
      if (payload.cover) book.cover = payload.cover;
      book.updated_at = now;
    }

    const chapterId = crypto.randomUUID();
    const chapter = { id: chapterId, title: payload.chapterTitle, body: payload.body, mode: payload.mode || 'scroll', created_at: now };
    book.chapters.push(chapter);
    book.updated_at = now;

    await env.STORIES.put('book:' + bookId, JSON.stringify(book));
    return new Response(JSON.stringify({ bookId, chapterId, publicUrl: `${url.origin}/reader.html?id=${bookId}&chapter=${chapterId}&mode=${chapter.mode}` }), { status: 201, headers: { 'content-type': 'application/json' } });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'content-type': 'application/json' } });
}
