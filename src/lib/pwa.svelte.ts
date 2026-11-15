import { registerSW } from 'virtual:pwa-register';

// Estado do service worker: "pronto para offline" e "nova versão disponível".
class PwaState {
  offlineReady = $state(false);
  needRefresh = $state(false);
  #update: ((reload?: boolean) => Promise<void>) | null = null;

  start() {
    if (!('serviceWorker' in navigator)) return;
    this.#update = registerSW({
      immediate: true,
      onOfflineReady: () => { this.offlineReady = true; },
      onNeedRefresh: () => { this.needRefresh = true; },
    });
  }

  update() {
    return this.#update?.(true);
  }

  dismiss() {
    this.needRefresh = false;
  }
}

export const pwa = new PwaState();
