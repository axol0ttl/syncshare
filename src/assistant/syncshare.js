import { candidate } from './fields';
import { quizMeta } from '../content/quiz/main';

const positiveId = value => /^\d+$/.test(value) && Number(value) > 0 ? String(value) : undefined;

export function syncShareContext() {
  const { courseId, quizId, attemptId } = quizMeta();
  const classes = document.body.className;
  const menu = document.querySelector('.usermenu, [data-region="user-menu"]');
  const profile = menu?.querySelector('a[href*="/user/profile.php"], a[href*="/user/view.php"]') ||
    document.querySelector('.logininfo a[href*="/user/"]');
  const config = [...document.scripts].find(s => s.textContent.includes('M.cfg') && /"userid"/i.test(s.textContent));
  const user = document.querySelector('body[data-userid], [data-region="user-menu"][data-userid], [data-region="drawer"][data-user-id]');
  const pageIds = new Set([...document.querySelectorAll('[data-userid], [data-user-id]')]
    .filter(el => !el.closest('.que')).map(el => positiveId(el.dataset.userid || el.dataset.userId)).filter(Boolean));
  const moodleId = positiveId(config?.textContent.match(/"userid"\s*:\s*"?(\d+)/i)?.[1]) ||
    positiveId(user?.dataset.userid || user?.dataset.userId) ||
    positiveId(profile && new URL(profile.href).searchParams.get('id')) ||
    (pageIds.size === 1 ? [...pageIds][0] : undefined);
  return {
    courseId: positiveId(classes.match(/\bcourse-(\d+)\b/)?.[1] || courseId),
    quizId: positiveId(classes.match(/\bcmid-(\d+)\b/)?.[1] || quizId),
    attemptId: positiveId(attemptId), moodleId
  };
}

// SyncShare v2 uses these order-independent numeric identities across shuffled attempts.
function identity(text) {
  const normalized = text.trim().toLowerCase().replace(/[\s:.,!?*+/\-]/g, '');
  let sum = 7;
  for (let i = 0; i < normalized.length; i++) sum += 31 * normalized.charCodeAt(i);
  return sum;
}
const compound = parts => parts.reduce((sum, part) => sum + ((part << 5) - part), 7);
const normalize = text => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');

function optionLabel(input) {
  return input.labels?.[0] || document.getElementById(input.getAttribute('aria-labelledby')) || input.parentElement;
}

function signature(node) {
  const copy = node.cloneNode(true);
  copy.querySelectorAll('.answernumber, .accesshide').forEach(el => el.remove());
  const text = (copy.innerText || copy.textContent).trim();
  const anchors = text ? [text] : [];
  let hash = text ? identity(text) : 0;
  for (const img of copy.querySelectorAll('img')) {
    let filename = img.src.split('/').pop();
    if (img.src.startsWith('data:')) {
      let checksum = 0;
      for (let i = 0; i < img.src.length; i++) checksum = (Math.imul(31, checksum) + img.src.charCodeAt(i)) | 0;
      filename = String(checksum);
    }
    hash = compound([hash, identity(filename)]);
    anchors.push(filename.split(/[?#]/)[0]);
  }
  return { hash, anchors };
}

export function syncShareQuestion(it) {
  if (!['radio', 'checkbox', 'text', 'match'].includes(it.kind)) return;
  const flag = it.que.querySelector('.questionflagpostdata');
  const flagData = new URLSearchParams(flag?.value);
  const questionId = positiveId(new URLSearchParams(flag?.dataset.originalValue).get('qid')) ||
    positiveId(flagData.get('actualQid')) || positiveId(flagData.get('qid'));
  const questionType = it.type || 'multichoice';
  const qt = it.que.querySelector('.qtext')?.cloneNode(true);
  if (!qt) return;
  qt.querySelectorAll('.accesshide').forEach(el => el.remove());
  let hash = identity(qt.innerText || qt.textContent);
  let signatures = [];
  if (it.kind === 'radio' || it.kind === 'checkbox') {
    signatures = it.inputs.map(el => signature(optionLabel(el)));
    hash = compound([hash, compound(signatures.map(s => s.hash))]);
  } else if (it.kind === 'match') {
    signatures = it.gaps.map(g => signature(g.el.closest('tr').querySelector('.text') || g.el.closest('tr').cells[0]));
    hash = compound([hash, ...signatures.map(s => s.hash)]);
  }
  return { query: { questionType, questionIdentity: String(hash), ...(questionId && { questionId }) },
    anchors: signatures.map(s => s.anchors) };
}

function matchAnchor(anchor, choices) {
  const wanted = new Set([].concat(anchor || []).filter(x => typeof x === 'string' && x.trim()).map(normalize));
  const indices = choices.map((options, i) => options.some(o => wanted.has(normalize(o))) ? i : -1).filter(i => i >= 0);
  return indices.length === 1 ? indices[0] : -1;
}

export function syncShareAnswers(group, solutions, answers, notices) {
  const anchors = group.syncShare.anchors;
  for (const solution of solutions) {
    if (!solution || typeof solution !== 'object') continue;
    const locked = solution.suggestionsLock;
    if (locked) notices.push('SyncShare · ' + (locked.message || 'Доступ к подсказкам ограничен.'));
    const matched = group.wire.kind === 'match';
    const fieldIndex = matched ? matchAnchor(solution.anchor, anchors) : 0;
    const field = group.fields[fieldIndex];
    if (!field) continue;
    function add(item, submission) {
      if (!item || item.correctness === 0 || typeof item.label !== 'string') return;
      const manual = submission || item.correctness !== 2;
      let plan, label = item.label;
      if (field.kind === 'text') {
        plan = { value: typeof item.data === 'string' ? item.data : item.label };
      } else if (field.kind === 'radio' || matched) {
        const choices = matched ? field.options.map(o => [o.text]) : anchors;
        let index = matchAnchor(matched ? item.data : item.data?.anchor, choices);
        if (index < 0) index = matchAnchor(item.label, choices);
        if (index >= 0) plan = { picks: [index] };
      } else if (field.kind === 'checkbox') {
        const index = matchAnchor(solution.anchor, anchors);
        if (index < 0) return;
        label = field.options[index].text + ' · ' + item.label;
      }
      const answer = plan && candidate(field, 'SyncShare', plan, manual);
      const entry = answer ? { ...answer, label } : { source: 'SyncShare', label, manual: true, displayOnly: true };
      if (Number.isFinite(item.confidence)) entry.percent = Math.round(item.confidence * 100);
      answers[fieldIndex].push(entry);
    }
    for (const item of locked ? [] : solution.suggestions || []) add(item, false);
    for (const item of solution.submissions || []) add(item, true);
  }
}
