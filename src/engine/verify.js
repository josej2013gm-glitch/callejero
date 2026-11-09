// Verificación independiente de preguntas generadas: recalcula la condición del
// enunciado sobre el modelo y comprueba que la opción correcta la cumple y las
// demás no. Se usa en las pruebas, en `npm run data:validate` y en el panel de administración.

import { validate } from './questions.js';
import { axisDiff, haversine } from './geo.js';

export function checkQuestion(M, q) {
  const errs = [];
  if (!validate(q)) return ['estructura inválida'];
  if (!q.options) return errs;
  const correct = q.options[q.answer];
  const wrong = q.options.filter((_, i) => i !== q.answer);
  const T = q.refs.streets?.[0];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };
  const kind = q.id.split(':')[0];
  switch (kind) {
    case 'identificar': case 'localizar': need(correct.ref === T, 'la opción correcta no es la vía objetivo'); break;
    case 'cruces':
      need(M.intersects(T, correct.ref), 'la correcta no cruza');
      for (const w of wrong) need(!M.intersects(T, w.ref) && M.minDist(T, w.ref) >= 15, `distractor «${w.label}» cruza o toca`);
      break;
    case 'crucepunto': {
      const P = M.pair.get(correct.ref);
      need(P && P.iso, 'el cruce señalado no es inequívoco');
      for (const w of wrong) need(haversine(M.pair.get(w.ref).c, P.c) > 40, `distractor «${w.label}» demasiado cerca`);
      break;
    }
    case 'proximas':
      need(M.minDist(T, correct.ref) <= 60, 'la correcta no está a ≤ 60 m');
      for (const w of wrong) need(M.minDist(T, w.ref) >= 300, `distractor «${w.label}» a menos de 300 m`);
      break;
    case 'paralelas':
      need(M.par.get(T).has(correct.ref), 'la correcta no es paralela');
      for (const w of wrong) need(axisDiff(M.street.get(T).axis, M.street.get(w.ref).axis) >= 40, `distractor «${w.label}» casi paralelo`);
      break;
    case 'perpendiculares':
      need(!!M.pairOf(T, correct.ref)?.perp, 'la correcta no es perpendicular');
      for (const w of wrong) need(!M.intersects(T, w.ref), `distractor «${w.label}» cruza`);
      break;
    case 'donde': {
      const P = M.poi.get(q.refs.pois[0]);
      need(correct.ref === P.street, 'la vía correcta no es la del edificio');
      for (const w of wrong) need(M.poiDist(P.id, w.ref) >= 120, `distractor «${w.label}» demasiado cerca del edificio`);
      break;
    }
    case 'quehay': {
      const P = M.poi.get(correct.ref);
      need(P.street === T, 'el edificio correcto no está en la vía');
      for (const w of wrong) need(M.poiDist(w.ref, T) >= 250, `distractor «${w.label}» demasiado cerca`);
      break;
    }
    case 'recorrido': {
      const [X, Y] = q.refs.streets;
      need(!M.intersects(X, Y), 'origen y destino se cruzan');
      need(M.intersects(X, correct.ref) && M.intersects(Y, correct.ref), 'la correcta no conecta ambas');
      for (const w of wrong) need(!(M.intersects(X, w.ref) && M.intersects(Y, w.ref)), `distractor «${w.label}» también conecta`);
      break;
    }
    case 'enlace':
      need(M.intersects(T, correct.ref), 'la correcta no enlaza');
      for (const w of wrong) need(!M.intersects(T, w.ref), `distractor «${w.label}» enlaza`);
      break;
    default: break;
  }
  return errs;
}
