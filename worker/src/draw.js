// Usa a fonte criptograficamente segura do runtime Workers; nunca Math.random().
export function randomInt(maxExclusive, getRandomValues = crypto.getRandomValues.bind(crypto)) {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x100000000) {
    throw new RangeError('Limite inválido');
  }
  const range = 0x100000000;
  const maxAllowed = Math.floor(range / maxExclusive) * maxExclusive;
  const bytes = new Uint32Array(1);
  do { getRandomValues(bytes); } while (bytes[0] >= maxAllowed);
  return bytes[0] % maxExclusive;
}
export function fisherYates(items, rng = randomInt) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = rng(i+1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
// Rejeição de permutações completas: distribuição uniforme entre desarranjos.
export function secretDraw(names, rng = randomInt) {
  if (new Set(names).size !== names.length || names.length < 2) throw new Error('Lista inválida');
  for (let tries = 0; tries < 10000; tries++) {
    const recipients = fisherYates(names,rng);
    if (recipients.every((name,i) => name !== names[i])) {
      return names.map((giver,i)=>({giver,recipient:recipients[i]}));
    }
  }
  throw new Error('Não foi possível sortear.');
}
