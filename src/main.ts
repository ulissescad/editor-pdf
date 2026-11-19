import { mount } from 'svelte';
import './styles/app.css';
import App from './App.svelte';
import { pwa } from './lib/pwa.svelte';
import { listenForLaunch } from './lib/incoming';
import { i18n } from './lib/i18n.svelte';

pwa.start();
listenForLaunch();
// O idioma (e o arquivo de tradução dele) vem antes do primeiro desenho, para o site não piscar em português
await i18n.init();

export default mount(App, { target: document.getElementById('app')! });
