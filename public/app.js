// Fetch books and render bookshelf tiles
async function loadLibrary() {
  const shelf = document.getElementById('shelf');
  shelf.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const res = await fetch('/api/books');
    if (!res.ok) throw new Error('Failed to load');
    const books = await res.json();

    if (!books.length) {
      shelf.innerHTML = '<p class="muted">No books yet.</p>';
      return;
    }

    shelf.innerHTML = '';
    books.forEach(book => {
      const tile = document.createElement('div');
      tile.className = 'book-tile';
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', `Open ${book.title}`);

      const img = document.createElement('img');
      img.className = 'spine';
      img.alt = book.title;
      img.src = book.spine || '/default-spine.png';

      const caption = document.createElement('div');
      caption.className = 'muted';
      caption.style.textAlign = 'center';
      caption.style.marginTop = '0.4rem';
      caption.textContent = book.title;

      tile.appendChild(img);
      tile.appendChild(caption);
      tile.addEventListener('click', () => openReader(book.id));
      shelf.appendChild(tile);
    });
  } catch (e) {
    shelf.innerHTML = `<p class="muted">Error loading library.</p>`;
    console.error(e);
  }
}

function openReader(bookId) {
  // open reader page; we'll pass first chapter by default in reader.html
  location.href = `/reader.html?id=${bookId}`;
}

loadLibrary();
