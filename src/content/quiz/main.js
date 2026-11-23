import browser from 'webextension-polyfill';
import MultiSource from 'shared/utils/MultiSource';
import BreadcrumbSource from 'content/quiz/sources/BreadcrumbSource';
import LinkSource from 'content/quiz/sources/quiz/LinkSource';
import URLSource from 'content/quiz/sources/quiz/URLSource';

export function quizMeta() {
    const page = new MultiSource(new BreadcrumbSource(), new LinkSource(), new URLSource());
    return {
        host: page.get('host'), courseId: page.get('courseId'), courseName: page.get('courseName'),
        quizId: page.get('quizId'), quizName: page.get('quizName'), attemptId: page.get('attemptId')
    };
}

export function trackQuizPage(review) {
    const meta = quizMeta();
    if (!meta.quizId || !meta.attemptId) return;
    const phase = review ? 'review' : 'attempt';
    browser.runtime.sendMessage({ type: phase + '-page-open', payload: meta });
    function report() {
        const questions = Array.from(document.querySelectorAll('div.que'), question => {
            const copy = question.cloneNode(true);
            copy.querySelectorAll('input[type="hidden"], input.questionflagpostdata').forEach(el => el.remove());
            return copy.outerHTML.replace(/sesskey=[^&"';\s]+/gi, '');
        });
        return browser.runtime.sendMessage({ type: 'quiz-' + phase + '-data', payload: { ...meta, questions } });
    }
    if (review) report();
    else window.addEventListener('pagehide', report, { once: true });
}
