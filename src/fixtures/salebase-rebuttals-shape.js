// Mock of Cody's captured Salebase structure.
// placement 'inner': <span><p><span>Title</span></p><div class=answer hidden-by-css>..</div></span>
// placement 'sibling': <span><p><span>Title</span></p></span><div class=answer>..</div><p class=answer>..</p>
function buildSalebase(placement, handler) {
  const titles = ["I'm not interested.", 'Can you mail it to me?', "I don't remember doing this!", 'Do we have to do a Zoom meeting? / Do I have to do this? / Why do I have to do this?', 'What is this all about?'];
  const outer = document.createElement('div'); document.body.append(document.createElement('div'), outer);
  for (let i = 0; i < 5; i++) outer.append(document.createElement('div'));
  const six = document.createElement('div'); outer.append(six);
  const a = document.createElement('div'); const container = document.createElement('div'); six.append(a); a.append(document.createElement('div'), container);
  container.innerHTML = '<span class="expandAll">Expand All</span> <span class="collapseAll">Collapse All</span>';
  titles.forEach((title, i) => {
    const wrap = document.createElement('span');
    wrap.innerHTML = `<p><span>${title}</span></p>`;
    const body = `<div class="answer">Rebuttal ${i} first paragraph.</div><p class="answer">Rebuttal ${i} second paragraph.</p>`;
    if (placement === 'inner') { wrap.insertAdjacentHTML('beforeend', body); container.append(wrap); }
    else { container.append(wrap); container.insertAdjacentHTML('beforeend', body); }
  });
  const answersOf = (wrap) => {
    if (placement === 'inner') return [...wrap.querySelectorAll('.answer')];
    const list = []; for (let n = wrap.nextElementSibling; n && !(n.tagName === 'SPAN'); n = n.nextElementSibling) list.push(n); return list;
  };
  const wraps = [...container.children].filter((n) => n.tagName === 'SPAN' && n.querySelector('p > span'));
  // jQuery-style delegated handlers on document.
  document.addEventListener('click', (e) => {
    window.__clicks.push(e.target.textContent.trim().slice(0, 20));
    // Like jQuery: $(document).on('click', 'p > span' | 'p', toggleRebuttal)
    if (e.target.closest('.expandAll')) { window.__expandAll = (window.__expandAll || 0) + 1; wraps.forEach((w) => answersOf(w).forEach((x) => x.style.display = 'block')); return; }
    if (e.target.closest('.collapseAll')) { window.__collapseAll = (window.__collapseAll || 0) + 1; wraps.forEach((w) => answersOf(w).forEach((x) => x.style.display = 'none')); return; }
    if (handler === 'none') return;
    const title = handler === 'span' ? e.target.closest('p > span') : e.target.closest('p');
    if (!title) return;
    const w = wraps.find((x) => x.contains(title)); if (!w) return;
    answersOf(w).forEach((x) => { x.style.display = x.style.display === 'block' ? 'none' : 'block'; });
  });
  return { container, wraps, answersOf };
}
