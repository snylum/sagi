// editor.js — safer flow: create session (enter password), upload cover to R2, then publish with X-SESSION

const preview = document.getElementById('preview');
const bodyField = document.getElementById('chapterBody');
const status = document.getElementById('status');

if (bodyField) {
  bodyField.addEventListener('input', () => {
    preview.innerHTML = marked.parse(bodyField.value || '');
  });
}

// Prompt for password once and get session token
async function ensureSession() {
  let token = sessionStorage.getItem('wb_session');
  if (token) {
    // optionally verify by trying a lightweight call (skip here to avoid complexity)
    return token;
  }
  const pw = prompt('Enter your publishing password (keeps secret off the code).');
  if (!pw) throw new Error('no-password');
  const res = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
  if (!res.ok) throw new Error('auth-failed');
  const data = await res.json();
  token = data.token;
  sessionStorage.setItem('wb_session', token);
  return token;
}

async function uploadCover(sessionToken, file) {
  if (!file) return '';
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const dataUri = `data:${file.type};base64,${b64}`;
  const payload = { filename: file.name, data: dataUri };
  const res = await fetch('/api/upload-cover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SESSION': sessionToken },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(()=>({error:'upload-failed'}));
    throw new Error(err.error || 'upload failed');
  }
  const j = await res.json();
  return j.url; // returns /r2/{key}
}

// Publish flow
const form = document.getElementById('bookForm');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'Preparing…';
  try {
    const token = await ensureSession();
    status.textContent = 'Uploading cover (if any)…';
    const coverFile = document.getElementById('bookCover').files[0];
    let coverUrl = '';
    if (coverFile) {
      coverUrl = await uploadCover(token, coverFile);
    }
    status.textContent = 'Publishing…';
    const bookId = document.getElementById('bookId').value.trim();
    const bookTitle = document.getElementById('bookTitle').value.trim();
    const bookDesc = document.getElementById('bookDesc').value.trim();
    const chapterTitle = document.getElementById('chapterTitle').value.trim();
    const body = document.getElementById('chapterBody').value.trim();
    const mode = document.getElementById('modeSelect').value;

    if (!bookTitle || !chapterTitle || !body) { alert('Missing fields'); status.textContent=''; return; }

    const payload = { bookId, bookTitle, bookDesc, cover: coverUrl, chapterTitle, body, mode };
    const res = await fetch('/api/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-SESSION': token },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(()=>({ error: 'publish failed' }));
      throw new Error(err.error || 'publish failed');
    }
    const j = await res.json();
    status.textContent = 'Published ✓';
    setTimeout(()=> {
      alert('Published! ' + j.publicUrl);
      status.textContent = '';
    }, 200);
  } catch (err) {
    console.error(err);
    if (err.message === 'auth-failed') alert('Authentication failed — check your password.');
    status.textContent = 'Error: ' + (err.message || err);
  }
});
