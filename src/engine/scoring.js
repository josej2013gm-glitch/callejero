// Puntuación de la prueba práctica de callejero.
// Se calcula en milésimas de punto con enteros para evitar errores de coma flotante.

export const OFFICIAL_RULES = Object.freeze({
  questions: 20,   // número de preguntas
  correct: 100,    // +0,10 puntos (en milésimas)
  wrong: 30,       // −0,03 puntos
  blank: 0,        // 0 puntos
  max: 2000,       // 2,00 puntos
  floorZero: true, // la nota final no baja de 0 (ver README: supuesto a contrastar con las bases)
});

/**
 * answers: array con, por pregunta, el índice elegido (0–3) o null si se deja en blanco.
 * correctIdx: array con el índice correcto de cada pregunta.
 */
export function scoreExam(answers, correctIdx, rules = OFFICIAL_RULES) {
  let correct = 0, wrong = 0, blank = 0;
  correctIdx.forEach((c, i) => {
    const a = answers[i];
    if (a === null || a === undefined) blank++;
    else if (a === c) correct++;
    else wrong++;
  });
  const n = correctIdx.length;
  const rawMilli = correct * rules.correct - wrong * rules.wrong - blank * rules.blank;
  const maxMilli = n === rules.questions ? rules.max : n * rules.correct;
  const notaMilli = Math.min(maxMilli, rules.floorZero ? Math.max(0, rawMilli) : rawMilli);
  return {
    n, correct, wrong, blank,
    raw: rawMilli / 1000, nota: notaMilli / 1000, max: maxMilli / 1000,
    // Nota equivalente sobre 2 puntos (útil para comparar simulacros de distinta longitud)
    sobre2: maxMilli ? Math.round(notaMilli * 2000 / maxMilli) / 1000 : 0,
    pct: n ? Math.round((correct / n) * 1000) / 10 : 0,
  };
}

/** Formatea una nota con dos decimales y coma decimal. */
export function fmtNota(x) {
  return (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
}

/** Nº de aciertos necesarios para obtener una nota, dados los fallos. */
export function aciertosPara(nota, fallos, rules = OFFICIAL_RULES) {
  return Math.ceil((nota * 1000 + fallos * rules.wrong) / rules.correct);
}
