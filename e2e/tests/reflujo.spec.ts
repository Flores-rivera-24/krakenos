import { login } from '../lib/auth.js';
import { registrarReflujo, TEXTOS_ES } from '../lib/reflujo.js';

registrarReflujo(TEXTOS_ES, (page) => login(page));
