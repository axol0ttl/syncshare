import { installFrame } from './frame';
import { panel } from './panel';

import { trackQuizPage } from '../content/quiz/main';

if (!document.querySelector('[data-syncshare]')) {
  if (location.pathname.endsWith('/mod/quiz/attempt.php')) trackQuizPage(false);
  installFrame(window === window.top ? panel() : null);
}
