import { mount } from 'svelte';
import './styles/app.css';
import App from './App.svelte';
import { pwa } from './lib/pwa.svelte';

pwa.start();

export default mount(App, { target: document.getElementById('app')! });
