module.exports = ({ isChrome, PACKAGE }) => {
    const moodle = (page, script) => ({
        matches: ['http://*/*', 'https://*/*'], include_globs: ['*/mod/quiz/' + page + '.php*'],
        js: ['src/' + script + '.js'], run_at: 'document_idle'
    });
    const icons = Object.fromEntries([16,24,32,48,64,128].map(size => [size, 'icons/icon@' + size + '.png']));
    return {
        manifest_version: 3, name: 'SyncShare', version: PACKAGE.version,
        description: '__MSG_extensionDescription__', default_locale: 'en',
        icons,
        permissions: ['storage', 'webNavigation'],
        host_permissions: ['https://polyvsp.ru/*', 'https://api.skipedu.xyz/*', 'https://*.openedu.ru/*'],
        action: { default_icon: icons, default_title: 'SyncShare', default_popup: 'options.html' },
        options_ui: { page: 'options.html', open_in_tab: true },
        content_scripts: [
            { matches: ['https://*.openedu.ru/*'], js: ['src/assistant.js'], all_frames: true, run_at: 'document_idle' },
            moodle('attempt', 'assistant'), moodle('review', 'quizreview'),
            moodle('summary', 'quizoverview'), moodle('view', 'quizboard')
        ],
        ...(isChrome ? { background: { service_worker: 'src/background.js' } } : {
            background: { scripts: ['src/background.js'] },
            browser_specific_settings: { gecko: { id: 'syncshare@naloaty.com' } }
        })
    };
};
