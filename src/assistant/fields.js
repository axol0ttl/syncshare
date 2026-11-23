// Keep DOM nodes in their owning frame. Provider results reference a field's ordered choices.
export function filled(field) {
  if (field.kind === 'text') return !!field.input.value.trim();
  if (field.kind === 'select') return field.options.some(o => o.value === field.input.value);
  return field.options.some(o => o.el.checked);
}

// Use the widget's drag handler so Moodle moves the visible word, records the
// matching placeinput and marks the attempt dirty through its normal UI flow.
async function placeWord(field, option) {
  const { root, input, group, drop, place } = field;
  if (!drop.isConnected || root.matches('.qtype_ddwtos-readonly')) return false;
  const used = root.querySelectorAll('input.placeinput.group' + group);
  if (!option.repeat && [...used].some(el => el !== input && el.value === option.value)) return false;
  if (input.value === option.value) return true;
  const word = root.querySelector('.draghome.group' + group + '.choice' + option.value + '.unplaced:not(.dragplaceholder)');
  const target = root.querySelector('.placed.inplace' + place) || drop;
  if (!word) return false;
  const start = word.getBoundingClientRect(), end = target.getBoundingClientRect();
  if (!start.width || !end.width) return false;
  function mouse(node, type, rect) {
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window,
      button: 0, buttons: type === 'mouseup' ? 0 : 1,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
  }
  mouse(word, 'mousedown', start);
  mouse(target, 'mousemove', end);
  mouse(target, 'mouseup', end);
  for (let i = 0; i < 30 && root.querySelector('.beingdragged'); i++) {
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  if (input.value !== option.value || !root.querySelector('.placed.inplace' + place + '.choice' + option.value)) return false;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function applyAnswer(field, answer, onlyEmpty) {
  const input = field.input;
  if (!input.isConnected || input.matches(':disabled, [readonly]') ||
      (onlyEmpty && filled(field))) return false;

  if (field.kind === 'radio' || field.kind === 'checkbox') {
    const picks = new Set(answer.picks);
    if (!picks.size || [...picks].some(i => !field.options[i])) return false;
    if (field.options.some(o => !o.el.isConnected || o.el.matches(':disabled'))) return false;
    for (const [i, option] of field.options.entries()) {
      const want = picks.has(i);
      if ((want || field.kind === 'checkbox') && option.el.checked !== want) option.el.click();
    }
    return field.options.every((o, i) => o.el.checked === picks.has(i));
  }

  const option = field.options[answer.picks?.[0]];
  const value = field.kind === 'text' ? answer.value : option?.value;
  if (!value || (option?.el && (!option.el.isConnected || option.el.matches(':disabled')))) return false;
  if (field.drop) return placeWord(field, option);
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  for (const type of ['input', 'change']) input.dispatchEvent(new Event(type, { bubbles: true }));
  return input.value === value;
}

export function candidate(field, source, plan, manual = false) {
  let label;
  if (field.kind === 'text') label = String(plan.value ?? '').trim();
  else {
    const picks = plan.picks;
    if (!Array.isArray(picks) || !picks.length || (field.kind !== 'checkbox' && picks.length !== 1) ||
        !picks.every(i => Number.isInteger(i) && field.options[i])) return null;
    label = picks.map(i => field.options[i].text).join(' · ');
  }
  return label ? { source, label, value: plan.value, picks: plan.picks, manual } : null;
}
