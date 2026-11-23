const { join } = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const PACKAGE = require('./package.json');

module.exports = (env, argv) => ({
    mode: argv.mode,
    entry: {
        background: './src/background/main.js', assistant: './src/assistant/main.js',
        options: './src/options/main.js', quizreview: './src/content/quiz/review.js',
        quizoverview: './src/content/quiz/overview.js', quizboard: './src/content/quiz/board.js'
    },
    output: { hashFunction: 'sha256', filename: 'src/[name].js', path: join(__dirname, 'dist'), clean: true },
    resolve: { modules: [join(__dirname, 'src'), 'node_modules'] },
    module: { rules: [{ test: /\.css$/, type: 'asset/source' }, { test: /\.png$/, type: 'asset/inline' }] },
    plugins: [
        new CopyPlugin({ patterns: [
            { from: 'src/icons', to: 'icons' }, { from: 'src/_locales', to: '_locales' },
            { from: 'src/styles/options.css', to: 'styles/options.css' },
            { from: 'src/options/options.html', to: 'options.html' },
            { from: 'src/manifest.cjs', to: 'manifest.json', transform() {
                const path = require.resolve('./src/manifest.cjs');
                delete require.cache[path];
                return JSON.stringify(require(path)({ isChrome: !!env.chrome, PACKAGE }), null, 2);
            } }
        ] })
    ],
    devtool: argv.mode === 'development' ? 'inline-source-map' : false
});
