// reader.js — smarter pagination: chunk markdown by paragraphs respecting char budget
const params = new URLSearchParams(location.search);
const bookId = params.get('id');
const initialChapter = params.get('chapter'); // optional
const overrideMode = params.get('mode');

const overlay = document.getElementById('overlay');
const root = document.getElementById('reader-root');
const bookEl = document.getElementById('book');
const pagesEl = document.getElementById('pages');
const coverFront = document.getElementById('cover-front');
const coverBack = document.getElementById('cover-back');
const tocPanel = document.getElementById('toc');
const tocList = document.getElementById('tocList');

const prevBtn = document.getElementById('prevChapter');
const nextBtn = document.getElementById('nextChapter');
const backBtn = document.getElementById('backLibrary');
const tocBtn = document.getElementById('tocBtn');

let bookData = null;
let currentChapterIndex = 0;
let flipping = false;

// Page size heuristic: characters per page (tweakable)
const CHARS_PER_PAGE = 1600;

async function init() {
  try {
    const res = await fetch(`/api/books/${bookId}`);
    if (!res.ok) throw new Error('Book not found');
    bookData = await res.json();
    openBookAnimation();

    if (initialChapter) {
      const idx = bookData.chapters.findIndex(c => c.id === initialChapter);
      currentChapterIndex = idx >= 0 ? idx : 0;
    } else currentChapterIndex = 0;

    renderTOC();
    showChapter(currentChapterIndex);
  } catch (e) {
    console.error(e);
    document.body.textContent = 'Failed to load book.';
  }
}

function renderTOC() {
  tocList.innerHTML = '';
  bookData.chapters.forEach((c, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<a href="#" data-index="${i}">${i+1}. ${escapeHtml(c.title)}</a>`;
    li.querySelector('a').addEventListener('click', (ev) => {
      ev.preventDefault();
      const ndx = Number(ev.target.dataset.index);
      jumpToChapter(ndx);
      hideTOC();
    });
    tocList.appendChild(li);
  });
}

// Smart paginator: split by paragraphs while keeping under CHARS_PER_PAGE
function paginateMarkdown(md, charsPerPage = CHARS_PER_PAGE) {
  // split by blank lines but keep paragraph integrity
  const paras = md.split(/\\n\\s*\\n/).map(p=>p.trim()).filter(Boolean);
  const pages = [];
  let current = '';
  for (const p of paras) {
    if (!current) {
      current = p;
    } else if ((current.length + p.length + 2) <= charsPerPage) {
      current += '\\n\\n' + p;
    } else {
      pages.push(current);
      current = p;
    }
  }
  if (current) pages.push(current);
  return pages;
}

function buildPagesForChapter(chapter) {
  pagesEl.innerHTML = '';
  const paras = paginateMarkdown(chapter.body || '', CHARS_PER_PAGE);
  if (!paras.length) paras.push('');
  paras.forEach((p, i) => {
    const page = document.createElement('div');
    page.className = 'page';
    page.dataset.index = i;
    page.innerHTML = marked.parse(p);
    // position stacking: earlier pages on top so they can flip
    page.style.zIndex = String(100 - i);
    pagesEl.appendChild(page);
  });
}

function showChapter(idx) {
  const chapter = bookData.chapters[idx];
  if (!chapter) return;
  currentChapterIndex = idx;
  buildPagesForChapter(chapter);
  coverFront.innerHTML = `<div style="padding:22px"><strong>${escapeHtml(bookData.title)}</strong><div class="muted" style="margin-top:8px">${escapeHtml(bookData.description)}</div></div>`;
  coverBack.innerHTML = `<div style="padding:22px"><strong>${escapeHtml(chapter.title)}</strong><div class="muted" style="margin-top:8px">Chapter ${idx+1}</div></div>`;

  const mode = overrideMode || chapter.mode || 'scroll';
  const pageEls = [...pagesEl.querySelectorAll('.page')];

  if (mode === 'novel') {
    // reset flips
    pageEls.forEach(el => el.classList.remove('flipped'));
    pageEls.forEach((el,i) => {
      el.addEventListener('click', () => {
        if (flipping) return;
        // only flip top-most (first unflipped)
        if (!el.classList.contains('flipped')) flipPageForward(el, i);
      });
    });
  } else {
    // scroll mode: make pages vertical scroll (remove absolute positioning)
    pageEls.forEach(el => {
      el.style.position = 'relative';
      el.style.transform = 'none';
      el.style.boxShadow = 'none';
    });
  }

  prevBtn.disabled = (idx === 0);
  nextBtn.disabled = (idx >= bookData.chapters.length - 1);
  history.replaceState({}, '', `/reader.html?id=${bookId}&chapter=${bookData.chapters[idx].id}&mode=${mode}`);
}

function flipPageForward(pageEl) {
  flipping = true;
  pageEl.classList.add('flipped');
  pageEl.addEventListener('transitionend', function onEnd() {
    pageEl.removeEventListener('transitionend', onEnd);
    flipping = false;
  });
}
function flipPageBackward(pageEl) {
  flipping = true;
  pageEl.classList.remove('flipped');
  pageEl.addEventListener('transitionend', function onEnd() {
    pageEl.removeEventListener('transitionend', onEnd);
    flipping = false;
  });
}

function jumpToChapter(newIndex) {
  if (newIndex < 0 || newIndex >= bookData.chapters.length) return;
  closeBookAnimation().then(() => {
    showChapter(newIndex);
    openBookAnimation();
  });
}
function nextChapter() { if (currentChapterIndex < bookData.chapters.length - 1) jumpToChapter(currentChapterIndex + 1); }
function prevChapter() { if (currentChapterIndex > 0) jumpToChapter(currentChapterIndex - 1); }

function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function openBookAnimation() {
  overlay.classList.remove('hidden');
  root.classList.remove('hidden');
  setTimeout(() => bookEl.classList.add('opening'), 60);
  setTimeout(() => {
    coverFront.style.transition = 'transform 0.9s cubic-bezier(.2,.9,.2,1)';
    coverFront.style.transformOrigin = 'left center';
    coverFront.style.transform = 'rotateY(-160deg)';
  }, 400);
}
function closeBookAnimation() {
  return new Promise((resolve) => {
    coverFront.style.transform = 'rotateY(0deg)';
    setTimeout(() => {
      bookEl.classList.remove('opening');
      setTimeout(() => {
        overlay.classList.add('hidden');
        root.classList.add('hidden');
        resolve();
      }, 500);
    }, 600);
  });
}

nextBtn.addEventListener('click', nextChapter);
prevBtn.addEventListener('click', prevChapter);
backBtn.addEventListener('click', async () => {
  await closeBookAnimation();
  location.href = '/';
});
tocBtn.addEventListener('click', () => {
  if (tocPanel.classList.contains('hidden')) showTOC(); else hideTOC();
});
function showTOC() { tocPanel.classList.remove('hidden'); }
function hideTOC() { tocPanel.classList.add('hidden'); }

init();
