import { parseHash, type Route } from './routes';

class Router {
  current = $state<Route>(parseHash(location.hash));

  constructor() {
    window.addEventListener('hashchange', () => {
      this.current = parseHash(location.hash);
      window.scrollTo(0, 0);
    });
  }
}

export const router = new Router();
