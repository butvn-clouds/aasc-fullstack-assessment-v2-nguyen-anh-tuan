import { mountLivePanel } from './live-browser';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mountDocsHeader } from './header-browser';

const asset = (name: string) => readFileSync(join(__dirname, name), 'utf8');
export const docsCss = asset('theme.css') + asset('live.css');
export const docsScript = `
window.mountDocsLive = ${mountLivePanel.toString()};
window.docsLiveTemplate = ${JSON.stringify(asset('live.html'))};
window.addEventListener('load', () => (${mountDocsHeader.toString()})(${JSON.stringify(asset('header.html'))}));
`;
