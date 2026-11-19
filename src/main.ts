import { mount } from 'svelte';
import './styles/app.css';
import App from './App.svelte';
import { pwa } from './lib/pwa.svelte';
import { listenForLaunch } from './lib/incoming';

pwa.start();
listenForLaunch();

export default mount(App, { target: document.getElementById('app')! });
